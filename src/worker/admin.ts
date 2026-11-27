import type { Context } from 'hono';
import type { AuditEntry, SettingsRecord } from '../shared/admin';
import type { AuditQuery, PatchSettingsInput } from '../shared/schemas';
import { ApiError } from '../shared/errors';
import { taskPriorityLabel, taskStatusLabel, toCsv } from '../shared/csv';
import { auditStatement } from './audit';
import { buildBackup } from './backup';
import { placeholders } from './profiles';
import { requireAdmin, requireUser, type CurrentUser } from './session';
import type { AppEnv } from './types';
import type { BackupDocument } from '../shared/backup-format';

const AUDIT_LIMIT = 200;

type AuditRow = {
  id: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: number;
};

type TaskExportRow = {
  title: string;
  description: string | null;
  group_name: string;
  status: string;
  priority: string;
  due_at: number | null;
  assignees: string | null;
};

export async function listAuditLogs(c: Context<AppEnv>, query: AuditQuery): Promise<AuditEntry[]> {
  const user = await requireUser(c);
  requireAdmin(user);
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (query.action) {
    where.push('a.action = ?');
    binds.push(query.action);
  }
  if (query.entityType) {
    where.push('a.entity_type = ?');
    binds.push(query.entityType);
  }
  if (query.entityId) {
    where.push('a.entity_id = ?');
    binds.push(query.entityId);
  }
  if (query.from) {
    where.push('a.created_at >= ?');
    binds.push(Date.parse(query.from));
  }
  if (query.to) {
    where.push('a.created_at <= ?');
    binds.push(Date.parse(query.to));
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT a.id, u.full_name AS actor_name, a.action, a.entity_type, a.entity_id, a.created_at
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id
     ${clause}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${AUDIT_LIMIT}`,
  )
    .bind(...binds)
    .all<AuditRow>();
  return rows.results.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function readSettings(c: Context<AppEnv>): Promise<SettingsRecord> {
  const user = await requireUser(c);
  requireAdmin(user);
  return settingsOf(c.env.DB);
}

export async function updateSettings(
  c: Context<AppEnv>,
  input: PatchSettingsInput,
): Promise<SettingsRecord> {
  const user = await requireUser(c);
  requireAdmin(user);
  const now = Date.now();
  const metadata: Record<string, string> = {};
  const statements: D1PreparedStatement[] = [];
  if (input.associationName !== undefined) {
    metadata.associationName = input.associationName;
    statements.push(
      c.env.DB.prepare(
        `UPDATE app_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = 'association_name'`,
      ).bind(input.associationName, now, user.id),
    );
  }
  if (input.dueSoonHours !== undefined) {
    metadata.dueSoonHours = String(input.dueSoonHours);
    statements.push(
      c.env.DB.prepare(
        `UPDATE app_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = 'due_soon_hours'`,
      ).bind(String(input.dueSoonHours), now, user.id),
    );
  }
  statements.push(
    auditStatement(c.env.DB, {
      actorId: user.id,
      action: 'settings.updated',
      entityType: 'settings',
      entityId: null,
      metadata,
      createdAt: now,
    }),
  );
  await c.env.DB.batch(statements);
  return settingsOf(c.env.DB);
}

export async function exportTasksCsv(c: Context<AppEnv>): Promise<string> {
  const user = await requireUser(c);
  if (user.role === 'volunteer') {
    throw new ApiError(403, 'forbidden', 'Non hai i permessi per questa operazione.');
  }
  const rows = await taskRows(c.env.DB, user);
  const csv = toCsv([
    ['Titolo', 'Descrizione', 'Gruppo', 'Stato', 'Priorità', 'Scadenza', 'Assegnatari'],
    ...rows.map((row) => [
      row.title,
      row.description ?? '',
      row.group_name,
      taskStatusLabel(row.status),
      taskPriorityLabel(row.priority),
      row.due_at === null ? '' : new Date(row.due_at).toISOString(),
      row.assignees ?? '',
    ]),
  ]);
  await auditStatement(c.env.DB, {
    actorId: user.id,
    action: 'export.tasks',
    entityType: 'export',
    entityId: null,
    createdAt: Date.now(),
  }).run();
  return csv;
}

export async function exportBackup(c: Context<AppEnv>): Promise<BackupDocument> {
  const user = await requireUser(c);
  requireAdmin(user);
  const now = Date.now();
  await auditStatement(c.env.DB, {
    actorId: user.id,
    action: 'export.backup',
    entityType: 'backup',
    entityId: null,
    createdAt: now,
  }).run();
  return buildBackup(c.env.DB, new Date(now).toISOString());
}

async function settingsOf(db: D1Database): Promise<SettingsRecord> {
  const rows = await db
    .prepare(
      `SELECT key, value FROM app_settings WHERE key IN ('association_name', 'due_soon_hours')`,
    )
    .all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  const hours = Number(values.get('due_soon_hours'));
  return {
    associationName: values.get('association_name') || 'Avis Berceto',
    dueSoonHours: Number.isInteger(hours) && hours > 0 ? hours : 24,
  };
}

async function taskRows(db: D1Database, user: CurrentUser): Promise<TaskExportRow[]> {
  if (user.role !== 'admin' && user.groups.length === 0) {
    return [];
  }
  const where: string[] = [];
  const binds: string[] = [];
  if (user.role !== 'admin') {
    const ids = user.groups.map((group) => group.id);
    where.push(`t.group_id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db
    .prepare(
      `SELECT t.title, t.description, g.name AS group_name, t.status, t.priority, t.due_at,
              (
                SELECT group_concat(u.full_name, ', ')
                FROM task_assignees a
                JOIN users u ON u.id = a.user_id
                WHERE a.task_id = t.id
              ) AS assignees
       FROM tasks t
       JOIN groups g ON g.id = t.group_id
       ${clause}
       ORDER BY t.created_at, t.id`,
    )
    .bind(...binds)
    .all<TaskExportRow>();
  return rows.results;
}
