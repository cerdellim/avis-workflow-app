import type { Context } from 'hono';
import {
  MAX_PEOPLE,
  type GroupRecord,
  type GroupStatus,
  type MemberRecord,
  type Profile,
} from '../shared/account';
import { ApiError } from '../shared/errors';
import type {
  CreateUserInput,
  GroupInput,
  PatchGroupInput,
  PatchUserInput,
} from '../shared/schemas';
import { LAST_ADMIN, issueLink } from './auth-service';
import { auditStatement } from './audit';
import type { AppEnv } from './types';
import {
  changed,
  countActiveAdmins,
  countUsers,
  findUserByEmail,
  findUserById,
  listMembers as membersOfGroup,
  listProfiles,
  loadProfile,
  placeholders,
} from './profiles';
import { requireAdmin, requireUser, revokeAllStatement } from './session';
import { loadSettings } from './settings';

const NOT_FOUND = 'Risorsa non trovata.';

export async function listUsers(c: Context<AppEnv>): Promise<{ items: Profile[] }> {
  const user = await requireUser(c);
  requireAdmin(user);
  return { items: await listProfiles(c.env.DB) };
}

export async function createUser(
  c: Context<AppEnv>,
  input: CreateUserInput,
): Promise<{ user: Profile; inviteUrl: string }> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const now = Date.now();
  if ((await countUsers(db)) >= MAX_PEOPLE) {
    throw new ApiError(409, 'conflict', 'Il portale può ospitare al massimo 15 persone.');
  }
  if (await findUserByEmail(db, input.email)) {
    throw new ApiError(409, 'conflict', 'Esiste già una persona con questa email.');
  }
  await assertGroupsExist(db, input.groupIds);

  const userId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO users (
           id, email, full_name, password_hash, role, status, password_changed_at, created_at, updated_at, disabled_at
         ) VALUES (?, ?, ?, NULL, ?, 'invited', NULL, ?, ?, NULL)`,
      )
      .bind(userId, input.email, input.fullName, input.role, now, now),
    auditStatement(db, {
      actorId: actor.id,
      action: 'user.created',
      entityType: 'user',
      entityId: userId,
      metadata: { role: input.role, status: 'invited' },
      createdAt: now,
    }),
  ];
  for (const groupId of input.groupIds) {
    statements.push(
      db
        .prepare(
          'INSERT INTO group_members (group_id, user_id, created_at, created_by) VALUES (?, ?, ?, ?)',
        )
        .bind(groupId, userId, now, actor.id),
      auditStatement(db, {
        actorId: actor.id,
        action: 'membership.added',
        entityType: 'group',
        entityId: groupId,
        metadata: { userId },
        createdAt: now,
      }),
    );
  }
  await db.batch(statements);
  const settings = await loadSettings(db);
  const inviteUrl = await issueLink(
    db,
    c.req.raw,
    actor.id,
    userId,
    'invite',
    settings.inviteTtlMs,
    now,
  );
  const user = await loadProfile(db, userId);
  if (!user) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return { user, inviteUrl };
}

export async function getUser(c: Context<AppEnv>, userId: string): Promise<Profile> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const user = await loadProfile(c.env.DB, userId);
  if (!user) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return user;
}

export async function updateUser(
  c: Context<AppEnv>,
  userId: string,
  input: PatchUserInput,
): Promise<Profile> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const current = await findUserById(db, userId);
  if (!current) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (
    current.role === 'admin' &&
    current.status === 'active' &&
    input.role !== 'admin' &&
    (await countActiveAdmins(db)) <= 1
  ) {
    throw new ApiError(409, 'conflict', LAST_ADMIN);
  }
  const other = await findUserByEmail(db, input.email);
  if (other && other.id !== current.id) {
    throw new ApiError(409, 'conflict', 'Esiste già una persona con questa email.');
  }
  const now = Date.now();
  await db.batch([
    db
      .prepare('UPDATE users SET full_name = ?, email = ?, role = ?, updated_at = ? WHERE id = ?')
      .bind(input.fullName, input.email, input.role, now, current.id),
    auditStatement(db, {
      actorId: actor.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: current.id,
      metadata: { role: input.role },
      createdAt: now,
    }),
  ]);
  const user = await loadProfile(db, current.id);
  if (!user) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return user;
}

export async function reinvite(c: Context<AppEnv>, userId: string): Promise<{ inviteUrl: string }> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const account = await findUserById(c.env.DB, userId);
  if (!account) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (account.status !== 'invited') {
    throw new ApiError(
      409,
      'conflict',
      'Si può inviare un nuovo invito solo a una persona non ancora attivata.',
    );
  }
  const settings = await loadSettings(c.env.DB);
  const inviteUrl = await issueLink(
    c.env.DB,
    c.req.raw,
    actor.id,
    account.id,
    'invite',
    settings.inviteTtlMs,
    Date.now(),
  );
  return { inviteUrl };
}

export async function issuePasswordReset(
  c: Context<AppEnv>,
  userId: string,
): Promise<{ resetUrl: string }> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const account = await findUserById(c.env.DB, userId);
  if (!account) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (account.status !== 'active') {
    throw new ApiError(
      409,
      'conflict',
      'Il link di password si invia solo a una persona già attiva.',
    );
  }
  const settings = await loadSettings(c.env.DB);
  const resetUrl = await issueLink(
    c.env.DB,
    c.req.raw,
    actor.id,
    account.id,
    'password_reset',
    settings.resetTtlMs,
    Date.now(),
  );
  return { resetUrl };
}

export async function disableUser(c: Context<AppEnv>, userId: string): Promise<Profile> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const account = await findUserById(db, userId);
  if (!account) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (account.status === 'disabled') {
    throw new ApiError(409, 'conflict', 'La persona è già disattivata.');
  }
  if (
    account.role === 'admin' &&
    account.status === 'active' &&
    (await countActiveAdmins(db)) <= 1
  ) {
    throw new ApiError(409, 'conflict', LAST_ADMIN);
  }
  const now = Date.now();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'disabled', disabled_at = ?, updated_at = ? WHERE id = ? AND status != 'disabled'`,
      )
      .bind(now, now, account.id),
    revokeAllStatement(db, account.id, now),
    auditStatement(db, {
      actorId: actor.id,
      action: 'user.disabled',
      entityType: 'user',
      entityId: account.id,
      createdAt: now,
    }),
  ]);
  if (changed(results[0]) !== 1) {
    throw new ApiError(409, 'conflict', 'La persona è già disattivata.');
  }
  const user = await loadProfile(db, account.id);
  if (!user) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return user;
}

export async function enableUser(c: Context<AppEnv>, userId: string): Promise<Profile> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const account = await findUserById(db, userId);
  if (!account) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (account.status === 'active') {
    throw new ApiError(409, 'conflict', 'La persona è già attiva.');
  }
  if (!account.password_hash) {
    throw new ApiError(
      409,
      'conflict',
      'Questa persona non ha ancora una password. Invia un nuovo invito.',
    );
  }
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'active', disabled_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(now, account.id),
    auditStatement(db, {
      actorId: actor.id,
      action: 'user.enabled',
      entityType: 'user',
      entityId: account.id,
      createdAt: now,
    }),
  ]);
  const user = await loadProfile(db, account.id);
  if (!user) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return user;
}

export async function listGroups(c: Context<AppEnv>): Promise<{ items: GroupRecord[] }> {
  const user = await requireUser(c);
  const rows =
    user.role === 'admin'
      ? await c.env.DB.prepare(
          'SELECT id, name, description, status FROM groups ORDER BY name COLLATE NOCASE',
        ).all<GroupRow>()
      : await c.env.DB.prepare(
          `SELECT g.id, g.name, g.description, g.status
           FROM groups g
           JOIN group_members m ON m.group_id = g.id
           WHERE m.user_id = ?
           ORDER BY g.name COLLATE NOCASE`,
        )
          .bind(user.id)
          .all<GroupRow>();
  return { items: rows.results.map(toGroup) };
}

export async function createGroup(c: Context<AppEnv>, input: GroupInput): Promise<GroupRecord> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  if (await findGroupByName(db, input.name, null)) {
    throw new ApiError(409, 'conflict', 'Esiste già un gruppo con questo nome.');
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const description = blankToNull(input.description);
  await db.batch([
    db
      .prepare(
        `INSERT INTO groups (id, name, description, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      )
      .bind(id, input.name, description, now, now),
    auditStatement(db, {
      actorId: actor.id,
      action: 'group.created',
      entityType: 'group',
      entityId: id,
      createdAt: now,
    }),
  ]);
  return { id, name: input.name, description, status: 'active' };
}

export async function updateGroup(
  c: Context<AppEnv>,
  groupId: string,
  input: PatchGroupInput,
): Promise<GroupRecord> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const current = await findGroupById(db, groupId);
  if (!current) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (await findGroupByName(db, input.name, current.id)) {
    throw new ApiError(409, 'conflict', 'Esiste già un gruppo con questo nome.');
  }
  const now = Date.now();
  const description = blankToNull(input.description);
  await db.batch([
    db
      .prepare(
        'UPDATE groups SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?',
      )
      .bind(input.name, description, input.status, now, current.id),
    auditStatement(db, {
      actorId: actor.id,
      action: 'group.updated',
      entityType: 'group',
      entityId: current.id,
      metadata: { status: input.status },
      createdAt: now,
    }),
  ]);
  return { id: current.id, name: input.name, description, status: input.status };
}

export async function groupMembers(
  c: Context<AppEnv>,
  groupId: string,
): Promise<{ members: MemberRecord[] }> {
  const user = await requireUser(c);
  await assertCanSeeGroup(
    c.env.DB,
    user.role === 'admin',
    user.groups.some((group) => group.id === groupId),
    groupId,
  );
  return { members: await membersOfGroup(c.env.DB, groupId) };
}

export async function replaceMembers(
  c: Context<AppEnv>,
  groupId: string,
  userIds: string[],
): Promise<{ members: MemberRecord[] }> {
  const actor = await requireUser(c);
  requireAdmin(actor);
  const db = c.env.DB;
  const group = await findGroupById(db, groupId);
  if (!group) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (userIds.length > 0) {
    const found = await db
      .prepare(`SELECT id FROM users WHERE id IN (${placeholders(userIds.length)})`)
      .bind(...userIds)
      .all<{ id: string }>();
    if (found.results.length !== userIds.length) {
      throw new ApiError(400, 'validation_error', 'Uno o più utenti non esistono.');
    }
  }
  const current = await db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .bind(group.id)
    .all<{ user_id: string }>();
  const currentIds = new Set(current.results.map((row) => row.user_id));
  const nextIds = new Set(userIds);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const userId of currentIds) {
    if (nextIds.has(userId)) {
      continue;
    }
    statements.push(
      db
        .prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
        .bind(group.id, userId),
      auditStatement(db, {
        actorId: actor.id,
        action: 'membership.removed',
        entityType: 'group',
        entityId: group.id,
        metadata: { userId },
        createdAt: now,
      }),
    );
  }
  for (const userId of userIds) {
    if (currentIds.has(userId)) {
      continue;
    }
    statements.push(
      db
        .prepare(
          'INSERT INTO group_members (group_id, user_id, created_at, created_by) VALUES (?, ?, ?, ?)',
        )
        .bind(group.id, userId, now, actor.id),
      auditStatement(db, {
        actorId: actor.id,
        action: 'membership.added',
        entityType: 'group',
        entityId: group.id,
        metadata: { userId },
        createdAt: now,
      }),
    );
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
  return { members: await membersOfGroup(db, group.id) };
}

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  status: GroupStatus;
};

function toGroup(row: GroupRow): GroupRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
  };
}

async function findGroupById(db: D1Database, id: string): Promise<GroupRow | null> {
  return db
    .prepare('SELECT id, name, description, status FROM groups WHERE id = ?')
    .bind(id)
    .first<GroupRow>();
}

async function findGroupByName(
  db: D1Database,
  name: string,
  exceptId: string | null,
): Promise<{ id: string } | null> {
  if (exceptId) {
    return db
      .prepare('SELECT id FROM groups WHERE name = ? AND id != ?')
      .bind(name, exceptId)
      .first<{ id: string }>();
  }
  return db.prepare('SELECT id FROM groups WHERE name = ?').bind(name).first<{ id: string }>();
}

async function assertGroupsExist(db: D1Database, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) {
    return;
  }
  const found = await db
    .prepare(`SELECT id FROM groups WHERE id IN (${placeholders(groupIds.length)})`)
    .bind(...groupIds)
    .all<{ id: string }>();
  if (found.results.length !== groupIds.length) {
    throw new ApiError(400, 'validation_error', 'Uno o più gruppi non esistono.');
  }
}

async function assertCanSeeGroup(
  db: D1Database,
  admin: boolean,
  member: boolean,
  groupId: string,
): Promise<void> {
  if (!admin && !member) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  const group = await findGroupById(db, groupId);
  if (!group) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
}

function blankToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}
