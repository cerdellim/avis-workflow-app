import type { Context } from 'hono';
import { resourcePath, type NotificationResource } from '../shared/notifications';
import type { Dashboard, DashboardAssignment, DashboardGroup } from '../shared/tasks';
import { placeholders } from './profiles';
import { requireUser, type CurrentUser } from './session';
import { loadSettings } from './settings';
import type { AppEnv } from './types';

const OPEN = "('todo', 'in_progress')";
const DAY_MS = 24 * 60 * 60 * 1000;

type CountRow = Record<string, number | null>;
type NotificationRow = {
  id: string;
  title: string;
  body: string;
  resource_type: NotificationResource;
  resource_id: string;
  created_at: number;
};
type AssignmentRow = { user_id: string; full_name: string; open_tasks: number | null };

export async function loadDashboard(c: Context<AppEnv>): Promise<Dashboard> {
  const user = await requireUser(c);
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const now = Date.now();
  const notifications = await readNotifications(db, user.id);
  if (user.role !== 'admin' && user.groups.length === 0) {
    return {
      personal: emptyPersonal(),
      notifications,
      group: user.role === 'volunteer' ? null : emptyGroup(),
    };
  }

  const scope = groupScope(user);
  const where = scope.sql.length > 0 ? `WHERE ${scope.sql}` : '';
  const openWhere = scope.sql.length > 0 ? `AND ${scope.sql}` : '';
  const checklistWhere =
    scope.binds.length > 0 ? `AND group_id IN (${placeholders(scope.binds.length)})` : '';
  const [assigned, claimable, totals, ownChecklists, groupChecklists, assignments] = await db.batch(
    [
      db
        .prepare(
          `SELECT COUNT(DISTINCT t.id) AS n
         FROM tasks t
         JOIN task_assignees a ON a.task_id = t.id AND a.user_id = ?
         WHERE t.status IN ${OPEN} ${openWhere}`,
        )
        .bind(user.id, ...scope.binds),
      db
        .prepare(
          `SELECT COUNT(*) AS n
         FROM tasks t
         WHERE t.status = 'todo'
           AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)
           ${openWhere}`,
        )
        .bind(...scope.binds),
      db
        .prepare(
          `SELECT
           COALESCE(SUM(CASE WHEN status IN ${OPEN} THEN 1 ELSE 0 END), 0) AS open_count,
           COALESCE(SUM(CASE WHEN status IN ${OPEN} AND priority = 'urgent' THEN 1 ELSE 0 END), 0) AS urgent_open,
           COALESCE(SUM(CASE WHEN status IN ${OPEN} AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END), 0) AS overdue,
           COALESCE(SUM(CASE WHEN status IN ${OPEN} AND due_at IS NOT NULL AND due_at >= ? AND due_at <= ? THEN 1 ELSE 0 END), 0) AS due_soon,
           COALESCE(SUM(CASE WHEN status = 'completed' AND completed_at >= ? THEN 1 ELSE 0 END), 0) AS completed_recent
         FROM tasks t
         ${where}`,
        )
        .bind(now, now, now + settings.dueSoonMs, now - 30 * DAY_MS, ...scope.binds),
      db
        .prepare(
          `SELECT COUNT(*) AS n
         FROM checklist_runs
         WHERE started_by = ? AND status = 'in_progress'`,
        )
        .bind(user.id),
      db
        .prepare(
          `SELECT COUNT(*) AS n
         FROM checklist_runs
         WHERE status = 'in_progress' ${checklistWhere}`,
        )
        .bind(...scope.binds),
      assignmentStatement(db, user),
    ],
  );

  const aggregate = (totals?.results[0] ?? {}) as CountRow;
  const personal = {
    assignedOpen: count(assigned),
    claimable: count(claimable),
    urgentOpen: countKey(aggregate, 'urgent_open'),
    overdue: countKey(aggregate, 'overdue'),
    dueSoon: countKey(aggregate, 'due_soon'),
    openChecklists: count(ownChecklists),
  };
  return {
    personal,
    notifications,
    group:
      user.role === 'volunteer'
        ? null
        : {
            open: countKey(aggregate, 'open_count'),
            overdue: countKey(aggregate, 'overdue'),
            completedLast30Days: countKey(aggregate, 'completed_recent'),
            checklistsInProgress: count(groupChecklists),
            assignments: ((assignments?.results ?? []) as AssignmentRow[]).map(toAssignment),
          },
  };
}

function groupScope(user: CurrentUser): { sql: string; binds: string[] } {
  if (user.role === 'admin') {
    return { sql: '', binds: [] };
  }
  const ids = user.groups.map((group) => group.id);
  return { sql: `t.group_id IN (${placeholders(ids.length)})`, binds: ids };
}

function assignmentStatement(db: D1Database, user: CurrentUser): D1PreparedStatement {
  if (user.role === 'volunteer') {
    return db
      .prepare(
        `SELECT u.id AS user_id, u.full_name, 0 AS open_tasks
       FROM users u
       WHERE u.id = ? AND 0 = 1`,
      )
      .bind(user.id);
  }
  const scope =
    user.role === 'admin'
      ? { sql: '', binds: [] as string[] }
      : {
          sql: `AND m.group_id IN (${placeholders(user.groups.length)})`,
          binds: user.groups.map((group) => group.id),
        };
  return db
    .prepare(
      `SELECT u.id AS user_id, u.full_name AS full_name,
              COUNT(DISTINCT CASE WHEN t.status IN ${OPEN} THEN t.id END) AS open_tasks
       FROM users u
       JOIN group_members m ON m.user_id = u.id
       LEFT JOIN task_assignees a ON a.user_id = u.id
       LEFT JOIN tasks t ON t.id = a.task_id AND t.group_id = m.group_id
       WHERE u.status = 'active' ${scope.sql}
       GROUP BY u.id, u.full_name
       ORDER BY u.full_name COLLATE NOCASE`,
    )
    .bind(...scope.binds);
}

async function readNotifications(
  db: D1Database,
  userId: string,
): Promise<Dashboard['notifications']> {
  const rows = await db
    .prepare(
      `SELECT id, title, body, resource_type, resource_id, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY CASE WHEN read_at IS NULL THEN 0 ELSE 1 END, created_at DESC
       LIMIT 5`,
    )
    .bind(userId)
    .all<NotificationRow>();
  return rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    path: resourcePath(row.resource_type, row.resource_id),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

function emptyPersonal(): Dashboard['personal'] {
  return {
    assignedOpen: 0,
    claimable: 0,
    urgentOpen: 0,
    overdue: 0,
    dueSoon: 0,
    openChecklists: 0,
  };
}

function emptyGroup(): DashboardGroup {
  return { open: 0, overdue: 0, completedLast30Days: 0, checklistsInProgress: 0, assignments: [] };
}

function toAssignment(row: AssignmentRow): DashboardAssignment {
  return { userId: row.user_id, fullName: row.full_name, openTasks: Number(row.open_tasks ?? 0) };
}

function count(result: D1Result | undefined): number {
  return countKey((result?.results[0] ?? {}) as CountRow, 'n');
}

function countKey(row: CountRow, key: string): number {
  const parsed = Number(row[key] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
