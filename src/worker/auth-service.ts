import type { Context } from 'hono';
import { MAX_PEOPLE, type Profile } from '../shared/account';
import { ApiError } from '../shared/errors';
import type {
  AcceptInput,
  ChangePasswordInput,
  LoginInput,
  PatchMeInput,
  SetupInput,
} from '../shared/schemas';
import { auditStatement } from './audit';
import { tokensMatch, sha256Hex, randomToken } from './crypto';
import type { AppEnv } from './types';
import { linkWithFragment } from './http';
import { hashPassword, verifyPassword } from './passwords';
import { countUsers, findUserByEmail, findUserById, loadProfile, changed } from './profiles';
import { assertAttemptLimit, clientAddress, recordAttempt } from './rate-limit';
import {
  clearSessionCookie,
  openSession,
  requireUser,
  revokeAllStatement,
  revokeSession,
} from './session';
import { loadSettings } from './settings';

const INVALID_CREDENTIALS = 'Credenziali non valide.';
const INVALID_LINK = 'Il link non è valido oppure è scaduto.';
const LAST_ADMIN = "L'associazione deve avere almeno un amministratore attivo.";

export async function setupStatus(c: Context<AppEnv>): Promise<{ initialized: boolean }> {
  const now = Date.now();
  const settings = await loadSettings(c.env.DB);
  await assertAttemptLimit(
    c.env.DB,
    'setup',
    `status:${clientAddress(c.req.raw)}`,
    60,
    settings.loginWindowMs,
    now,
  );
  const row = await c.env.DB.prepare('SELECT 1 AS present FROM users LIMIT 1').first();
  return { initialized: row !== null };
}

export async function setupAccount(c: Context<AppEnv>, input: SetupInput): Promise<Profile> {
  const now = Date.now();
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const subject = `bootstrap:${clientAddress(c.req.raw)}`;
  await assertAttemptLimit(db, 'setup', subject, 10, settings.loginWindowMs, now);
  const secret = c.env.BOOTSTRAP_TOKEN;
  if (!secret) {
    throw new ApiError(503, 'unavailable', 'Il primo avvio non è configurato.');
  }
  const matches = await tokensMatch(input.bootstrapToken, secret);
  const existing = await db.prepare('SELECT 1 AS present FROM users LIMIT 1').first();
  if (existing) {
    await recordAttempt(db, 'setup', subject, false, now);
    throw new ApiError(404, 'not_found', 'Risorsa non trovata.');
  }
  if (!matches) {
    await recordAttempt(db, 'setup', subject, false, now);
    throw new ApiError(401, 'unauthenticated', 'Codice di avvio non valido.');
  }
  if ((await countUsers(db)) >= MAX_PEOPLE) {
    throw new ApiError(409, 'conflict', 'Il portale può ospitare al massimo 15 persone.');
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           id, email, full_name, password_hash, role, status, password_changed_at, created_at, updated_at, disabled_at
         ) VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?, NULL)`,
      )
      .bind(userId, input.email, input.fullName, passwordHash, now, now, now),
    auditStatement(db, {
      actorId: userId,
      action: 'user.created',
      entityType: 'user',
      entityId: userId,
      metadata: { role: 'admin', status: 'active' },
      createdAt: now,
    }),
  ]);
  await openSession(c, userId, now);
  return {
    id: userId,
    fullName: input.fullName,
    email: input.email,
    role: 'admin',
    status: 'active',
    groups: [],
  };
}

export async function login(c: Context<AppEnv>, input: LoginInput): Promise<Profile> {
  const now = Date.now();
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const emailSubject = `email:${input.email}`;
  const ipSubject = `ip:${clientAddress(c.req.raw)}`;
  await assertAttemptLimit(
    db,
    'login',
    emailSubject,
    settings.loginMaxFailures,
    settings.loginWindowMs,
    now,
  );
  await assertAttemptLimit(db, 'login', ipSubject, 20, settings.loginWindowMs, now);

  const user = await findUserByEmail(db, input.email);
  const passwordOk = await verifyPassword(input.password, user?.password_hash ?? null);
  if (!user || user.status !== 'active' || !passwordOk) {
    await recordAttempt(db, 'login', emailSubject, false, now);
    await recordAttempt(db, 'login', ipSubject, false, now);
    throw new ApiError(401, 'unauthenticated', INVALID_CREDENTIALS);
  }

  await openSession(c, user.id, now);
  const profile = await loadProfile(db, user.id);
  if (!profile) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return profile;
}

export async function logout(c: Context<AppEnv>): Promise<void> {
  const user = await requireUser(c);
  await revokeSession(c.env.DB, user.sessionId, Date.now());
  clearSessionCookie(c);
}

export async function acceptInvite(c: Context<AppEnv>, input: AcceptInput): Promise<Profile> {
  return consumeToken(c, input, 'invite');
}

export async function confirmReset(c: Context<AppEnv>, input: AcceptInput): Promise<{ ok: true }> {
  await consumeToken(c, input, 'password_reset');
  return { ok: true };
}

export async function updateOwnName(c: Context<AppEnv>, input: PatchMeInput): Promise<Profile> {
  const user = await requireUser(c);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?').bind(
      input.fullName,
      now,
      user.id,
    ),
    auditStatement(c.env.DB, {
      actorId: user.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: user.id,
      createdAt: now,
    }),
  ]);
  return {
    id: user.id,
    fullName: input.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    groups: user.groups,
  };
}

export async function changePassword(
  c: Context<AppEnv>,
  input: ChangePasswordInput,
): Promise<{ ok: true }> {
  const user = await requireUser(c);
  const now = Date.now();
  const db = c.env.DB;
  const settings = await loadSettings(db);
  await assertAttemptLimit(
    db,
    'password_reset',
    `change:${user.id}`,
    10,
    settings.loginWindowMs,
    now,
  );
  const row = await findUserById(db, user.id);
  const passwordOk = await verifyPassword(input.currentPassword, row?.password_hash ?? null);
  if (!passwordOk) {
    await recordAttempt(db, 'password_reset', `change:${user.id}`, false, now);
    throw new ApiError(401, 'unauthenticated', 'La password attuale non è corretta.');
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.batch([
    db
      .prepare(
        'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
      )
      .bind(passwordHash, now, now, user.id),
    revokeAllStatement(db, user.id, now),
    auditStatement(db, {
      actorId: user.id,
      action: 'password.changed',
      entityType: 'user',
      entityId: user.id,
      metadata: { via: 'change' },
      createdAt: now,
    }),
  ]);
  await openSession(c, user.id, now);
  return { ok: true };
}

async function consumeToken(
  c: Context<AppEnv>,
  input: AcceptInput,
  purpose: 'invite' | 'password_reset',
): Promise<Profile> {
  const now = Date.now();
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const subject = `${purpose}:${clientAddress(c.req.raw)}`;
  const scope = purpose === 'invite' ? 'invite' : 'password_reset';
  await assertAttemptLimit(db, scope, subject, 10, settings.loginWindowMs, now);

  const tokenHash = await sha256Hex(input.token);
  const tokenRow = await db
    .prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM invitation_tokens
       WHERE token_hash = ? AND purpose = ?`,
    )
    .bind(tokenHash, purpose)
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  const account = tokenRow ? await findUserById(db, tokenRow.user_id) : null;
  const usable =
    tokenRow !== null &&
    tokenRow.used_at === null &&
    tokenRow.expires_at > now &&
    account !== null &&
    (purpose === 'invite' ? account.status === 'invited' : account.status === 'active');

  if (!usable || !tokenRow || !account) {
    await recordAttempt(db, scope, subject, false, now);
    throw new ApiError(401, 'unauthenticated', INVALID_LINK);
  }

  const passwordHash = await hashPassword(input.password);
  const userUpdate =
    purpose === 'invite'
      ? db
          .prepare(
            `UPDATE users
             SET password_hash = ?, status = 'active', password_changed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'invited'`,
          )
          .bind(passwordHash, now, now, account.id)
      : db
          .prepare(
            `UPDATE users
             SET password_hash = ?, password_changed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'active'`,
          )
          .bind(passwordHash, now, now, account.id);
  const results = await db.batch([
    userUpdate,
    db
      .prepare(
        `UPDATE invitation_tokens
         SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM users
             WHERE users.id = invitation_tokens.user_id AND users.password_changed_at = ?
           )`,
      )
      .bind(now, tokenRow.id, now, now),
  ]);
  if (changed(results[0]) !== 1 || changed(results[1]) !== 1) {
    await recordAttempt(db, scope, subject, false, now);
    throw new ApiError(401, 'unauthenticated', INVALID_LINK);
  }

  const statements = [
    revokeAllStatement(db, account.id, now),
    auditStatement(db, {
      actorId: account.id,
      action: 'password.changed',
      entityType: 'user',
      entityId: account.id,
      metadata: { via: purpose },
      createdAt: now,
    }),
  ];
  if (purpose === 'invite') {
    statements.push(
      auditStatement(db, {
        actorId: account.id,
        action: 'user.updated',
        entityType: 'user',
        entityId: account.id,
        metadata: { status: 'active' },
        createdAt: now,
      }),
    );
  }
  await db.batch(statements);
  c.set('userId', account.id);
  if (purpose === 'invite') {
    await openSession(c, account.id, now);
  }
  const profile = await loadProfile(db, account.id);
  if (!profile) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return profile;
}

export async function issueLink(
  db: D1Database,
  request: Request,
  actorId: string,
  userId: string,
  purpose: 'invite' | 'password_reset',
  ttlMs: number,
  now: number,
): Promise<string> {
  const token = randomToken();
  await db.batch([
    db
      .prepare(
        `UPDATE invitation_tokens
         SET used_at = ?
         WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
      )
      .bind(now, userId, purpose),
    db
      .prepare(
        `INSERT INTO invitation_tokens (id, user_id, token_hash, purpose, expires_at, used_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        await sha256Hex(token),
        purpose,
        now + ttlMs,
        actorId,
        now,
      ),
    auditStatement(db, {
      actorId,
      action: purpose === 'invite' ? 'invite.issued' : 'password.reset_issued',
      entityType: 'user',
      entityId: userId,
      metadata: { purpose },
      createdAt: now,
    }),
  ]);
  const path = purpose === 'invite' ? '/attiva' : '/reimposta-password';
  return linkWithFragment(request, path, token);
}

export { LAST_ADMIN };
