import type { Context } from 'hono';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushSubscriptionInput } from '../shared/schemas';
import { ApiError } from '../shared/errors';
import {
  resourcePath,
  type NotificationItem,
  type NotificationList,
  type NotificationResource,
  type NotificationType,
} from '../shared/notifications';
import { changed, placeholders } from './profiles';
import { requireUser } from './session';
import type { AppEnv } from './types';

const NOT_FOUND = 'Risorsa non trovata.';
const PUSH_UNAVAILABLE = 'Le notifiche push non sono configurate.';
const LIST_LIMIT = 50;
const DEADLINE_LIMIT = 40;
const PUSH_BATCH = 5;
const MINUTE = 60 * 1000;
const RETRY_AFTER = [15 * MINUTE, 60 * MINUTE, 6 * 60 * MINUTE];

const COPY: Record<NotificationType, { title: string; dedupKey: string }> = {
  task_assigned: { title: 'Nuova attività', dedupKey: 'assigned' },
  task_due_soon: { title: 'Attività in scadenza', dedupKey: 'due-soon' },
  task_overdue: { title: 'Attività scaduta', dedupKey: 'overdue' },
  task_completed: { title: 'Attività completata', dedupKey: 'completed' },
  checklist_completed: { title: 'Checklist completata', dedupKey: 'completed' },
};

export type Notice = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType: NotificationResource;
  resourceId: string;
  dedupKey: string;
};

export type NoticeGate =
  { kind: 'always' } | { kind: 'changes' } | { kind: 'task'; taskId: string };

export type PushPayload = {
  title: string;
  body: string;
  path: string;
};

export type PushEncoder = (
  payload: PushPayload,
  subscription: { endpoint: string; p256dh: string; auth: string },
) => Promise<RequestInit>;

export type PushSender = (endpoint: string, init: RequestInit) => Promise<{ status: number }>;

export type TickOptions = {
  vapid?: { publicKey: string; privateKey: string; subject: string };
  encoder?: PushEncoder;
  sender?: PushSender;
};

type NoticeRow = Notice & { id: string };

type DeadlineTask = {
  id: string;
  title: string;
  group_id: string;
  kind: 'task_due_soon' | 'task_overdue';
};

type DeliveryRow = {
  id: string;
  attempts: number;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  title: string;
  body: string;
  resource_type: NotificationResource;
  resource_id: string;
};

type StoredNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  resource_type: NotificationResource;
  resource_id: string;
  read_at: number | null;
  created_at: number;
};

export function taskNotice(
  userId: string,
  type: 'task_assigned' | 'task_due_soon' | 'task_overdue' | 'task_completed',
  taskTitle: string,
  taskId: string,
): Notice {
  return notice(userId, type, taskTitle, 'task', taskId);
}

export function checklistNotice(userId: string, title: string, runId: string): Notice {
  return notice(userId, 'checklist_completed', title, 'checklist_run', runId);
}

export async function coordinatorIds(
  db: D1Database,
  groupId: string,
  exceptUserId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT u.id
       FROM users u
       JOIN group_members m ON m.user_id = u.id AND m.group_id = ?
       WHERE u.role = 'coordinator' AND u.status = 'active' AND u.id != ?`,
    )
    .bind(groupId, exceptUserId)
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

export async function loadSubscriptionMap(
  db: D1Database,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return map;
  }
  const rows = await db
    .prepare(
      `SELECT id, user_id FROM push_subscriptions WHERE user_id IN (${placeholders(unique.length)})`,
    )
    .bind(...unique)
    .all<{ id: string; user_id: string }>();
  for (const row of rows.results) {
    const current = map.get(row.user_id) ?? [];
    current.push(row.id);
    map.set(row.user_id, current);
  }
  return map;
}

export function noticeStatements(
  db: D1Database,
  notices: readonly Notice[],
  subscriptions: ReadonlyMap<string, readonly string[]>,
  now: number,
  gate: NoticeGate,
): D1PreparedStatement[] {
  if (notices.length === 0) {
    return [];
  }
  const rows = notices.map((item) => ({ ...item, id: crypto.randomUUID() }));
  const statements = [insertNotices(db, rows, now, gate)];
  for (const row of rows) {
    for (const subscriptionId of subscriptions.get(row.userId) ?? []) {
      statements.push(insertDelivery(db, row.id, subscriptionId, now));
    }
  }
  return statements;
}

export async function createDeadlineNotices(
  db: D1Database,
  now: number,
  dueSoonMs: number,
): Promise<number> {
  const tasks = [
    ...(await missingTasks(db, 'task_due_soon', now, dueSoonMs)),
    ...(await missingTasks(db, 'task_overdue', now, dueSoonMs)),
  ];
  if (tasks.length === 0) {
    return 0;
  }
  const assignees = await taskAssignees(
    db,
    tasks.map((task) => task.id),
  );
  const openGroups = [
    ...new Set(tasks.filter((task) => !assignees.has(task.id)).map((task) => task.group_id)),
  ];
  const members = await activeMembers(db, openGroups);
  const planned = new Map<string, Notice[]>();
  const recipients: string[] = [];
  for (const task of tasks) {
    const people = assignees.get(task.id) ?? members.get(task.group_id) ?? [];
    const notices = people.map((userId) => taskNotice(userId, task.kind, task.title, task.id));
    if (notices.length > 0) {
      planned.set(`${task.kind}:${task.id}`, notices);
      recipients.push(...people);
    }
  }
  const subscriptions = await loadSubscriptionMap(db, recipients);
  const groups = [...planned.values()].map((notices) =>
    noticeStatements(db, notices, subscriptions, now, { kind: 'always' }),
  );
  await runChunks(db, groups);
  return [...planned.values()].reduce((total, notices) => total + notices.length, 0);
}

export async function drainPush(
  db: D1Database,
  now: number,
  options?: TickOptions,
): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.attempts, d.subscription_id, s.endpoint, s.p256dh, s.auth_key,
              n.title, n.body, n.resource_type, n.resource_id
       FROM push_deliveries d
       JOIN push_subscriptions s ON s.id = d.subscription_id
       JOIN notifications n ON n.id = d.notification_id
       WHERE d.status IN ('pending', 'failed') AND d.next_attempt_at <= ?
       ORDER BY d.next_attempt_at, d.id
       LIMIT ?`,
    )
    .bind(now, PUSH_BATCH)
    .all<DeliveryRow>();
  let sent = 0;
  const removed = new Set<string>();
  for (const row of rows.results) {
    if (removed.has(row.subscription_id)) {
      continue;
    }
    const payload: PushPayload = {
      title: row.title,
      body: row.body,
      path: resourcePath(row.resource_type, row.resource_id),
    };
    const subscription = { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth_key };
    let status: number;
    try {
      const init = options?.encoder
        ? await options.encoder(payload, subscription)
        : await encodeWithVapid(payload, subscription, options?.vapid);
      if (!init) {
        console.log(JSON.stringify({ code: 'push_unconfigured', job: 'push' }));
        break;
      }
      const response = options?.sender
        ? await options.sender(row.endpoint, init)
        : await fetch(row.endpoint, init);
      status = response.status;
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      await markSent(db, row, status, now);
      sent += 1;
      continue;
    }
    if (status === 404 || status === 410) {
      await abandonSubscription(db, row, status, now);
      removed.add(row.subscription_id);
      continue;
    }
    await scheduleRetry(db, row, status, now);
  }
  return sent;
}

export function vapidOptions(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}): TickOptions {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return {};
  }
  return {
    vapid: {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    },
  };
}

export async function listNotifications(c: Context<AppEnv>): Promise<NotificationList> {
  const user = await requireUser(c);
  const [counts, rows] = await c.env.DB.batch([
    c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT id, type, title, body, resource_type, resource_id, read_at, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY CASE WHEN read_at IS NULL THEN 0 ELSE 1 END, created_at DESC
       LIMIT ?`,
    ).bind(user.id, LIST_LIMIT),
  ]);
  const countRow = counts?.results[0] as { n?: number } | undefined;
  return {
    unread: Number(countRow?.n ?? 0),
    items: ((rows?.results ?? []) as StoredNotification[]).map(toItem),
  };
}

export async function markNotificationRead(
  c: Context<AppEnv>,
  notificationId: string,
): Promise<NotificationItem> {
  const user = await requireUser(c);
  const db = c.env.DB;
  const owned = await db
    .prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?')
    .bind(notificationId, user.id)
    .first<{ id: string }>();
  if (!owned) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  const now = Date.now();
  await db
    .prepare(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
    )
    .bind(now, notificationId, user.id)
    .run();
  const row = await db
    .prepare(
      `SELECT id, type, title, body, resource_type, resource_id, read_at, created_at
       FROM notifications WHERE id = ? AND user_id = ?`,
    )
    .bind(notificationId, user.id)
    .first<StoredNotification>();
  if (!row) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return toItem(row);
}

export async function markAllNotificationsRead(c: Context<AppEnv>): Promise<{ updated: number }> {
  const user = await requireUser(c);
  const result = await c.env.DB.prepare(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
  )
    .bind(Date.now(), user.id)
    .run();
  return { updated: changed(result) };
}

export async function vapidPublicKey(c: Context<AppEnv>): Promise<{ publicKey: string }> {
  await requireUser(c);
  const publicKey = c.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new ApiError(404, 'not_found', PUSH_UNAVAILABLE);
  }
  return { publicKey };
}

export async function savePushSubscription(
  c: Context<AppEnv>,
  input: PushSubscriptionInput,
): Promise<{ id: string }> {
  const user = await requireUser(c);
  const now = Date.now();
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 200);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (
       id, user_id, endpoint, p256dh, auth_key, user_agent, created_at, failure_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth_key = excluded.auth_key,
       user_agent = excluded.user_agent,
       failure_count = 0`,
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      userAgent.length > 0 ? userAgent : null,
      now,
    )
    .run();
  const row = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
    .bind(input.endpoint)
    .first<{ id: string }>();
  if (!row) {
    throw new ApiError(500, 'internal_error', 'Si è verificato un errore. Riprova.');
  }
  return { id: row.id };
}

export async function deletePushSubscription(
  c: Context<AppEnv>,
  subscriptionId: string,
): Promise<{ ok: true }> {
  const user = await requireUser(c);
  const result = await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?',
  )
    .bind(subscriptionId, user.id)
    .run();
  // La cancellazione in cascata delle consegne può contare più di una riga.
  if (changed(result) < 1) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return { ok: true };
}

function notice(
  userId: string,
  type: NotificationType,
  body: string,
  resourceType: NotificationResource,
  resourceId: string,
): Notice {
  const copy = COPY[type];
  return {
    userId,
    type,
    title: copy.title,
    body,
    resourceType,
    resourceId,
    dedupKey: copy.dedupKey,
  };
}

function insertNotices(
  db: D1Database,
  rows: readonly NoticeRow[],
  now: number,
  gate: NoticeGate,
): D1PreparedStatement {
  const selects = rows.map(
    () =>
      'SELECT ? AS id, ? AS user_id, ? AS type, ? AS title, ? AS body, ? AS resource_type, ? AS resource_id, ? AS dedup_key, ? AS created_at',
  );
  const binds: (string | number)[] = [];
  for (const row of rows) {
    binds.push(
      row.id,
      row.userId,
      row.type,
      row.title,
      row.body,
      row.resourceType,
      row.resourceId,
      row.dedupKey,
      now,
    );
  }
  let where = '';
  if (gate.kind === 'changes') {
    where = 'WHERE changes() > 0';
  } else if (gate.kind === 'task') {
    where = 'WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)';
    binds.push(gate.taskId);
  }
  return db
    .prepare(
      `INSERT OR IGNORE INTO notifications (
         id, user_id, type, title, body, resource_type, resource_id, dedup_key, created_at
       )
       SELECT id, user_id, type, title, body, resource_type, resource_id, dedup_key, created_at
       FROM (
         ${selects.join(' UNION ALL ')}
       )
       ${where}`,
    )
    .bind(...binds);
}

function insertDelivery(
  db: D1Database,
  notificationId: string,
  subscriptionId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO push_deliveries (
         id, notification_id, subscription_id, status, attempts, next_attempt_at,
         last_status_code, last_error, created_at, updated_at
       )
       SELECT ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?
       WHERE EXISTS (SELECT 1 FROM notifications WHERE id = ?)`,
    )
    .bind(crypto.randomUUID(), notificationId, subscriptionId, now, now, now, notificationId);
}

async function missingTasks(
  db: D1Database,
  kind: DeadlineTask['kind'],
  now: number,
  dueSoonMs: number,
): Promise<DeadlineTask[]> {
  const overdue = kind === 'task_overdue';
  const window = overdue ? 't.due_at < ?' : 't.due_at >= ? AND t.due_at <= ?';
  const binds = overdue
    ? [now, kind, COPY[kind].dedupKey]
    : [now, now + dueSoonMs, kind, COPY[kind].dedupKey];
  const rows = await db
    .prepare(
      `SELECT t.id, t.title, t.group_id
       FROM tasks t
       WHERE t.status IN ('todo', 'in_progress')
         AND t.due_at IS NOT NULL
         AND ${window}
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.resource_type = 'task'
             AND n.resource_id = t.id
             AND n.type = ?
             AND n.dedup_key = ?
         )
       ORDER BY t.due_at, t.id
       LIMIT ?`,
    )
    .bind(...binds, DEADLINE_LIMIT)
    .all<{ id: string; title: string; group_id: string }>();
  return rows.results.map((row) => ({ ...row, kind }));
}

async function taskAssignees(
  db: D1Database,
  taskIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) {
    return map;
  }
  const rows = await db
    .prepare(
      `SELECT task_id, user_id FROM task_assignees WHERE task_id IN (${placeholders(taskIds.length)})`,
    )
    .bind(...taskIds)
    .all<{ task_id: string; user_id: string }>();
  for (const row of rows.results) {
    const current = map.get(row.task_id) ?? [];
    current.push(row.user_id);
    map.set(row.task_id, current);
  }
  return map;
}

async function activeMembers(
  db: D1Database,
  groupIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) {
    return map;
  }
  const rows = await db
    .prepare(
      `SELECT m.group_id, u.id AS user_id
       FROM group_members m
       JOIN users u ON u.id = m.user_id AND u.status = 'active'
       WHERE m.group_id IN (${placeholders(groupIds.length)})`,
    )
    .bind(...groupIds)
    .all<{ group_id: string; user_id: string }>();
  for (const row of rows.results) {
    const current = map.get(row.group_id) ?? [];
    current.push(row.user_id);
    map.set(row.group_id, current);
  }
  return map;
}

async function runChunks(db: D1Database, groups: D1PreparedStatement[][]): Promise<void> {
  let batch: D1PreparedStatement[] = [];
  for (const group of groups) {
    if (group.length === 0) {
      continue;
    }
    if (batch.length > 0 && batch.length + group.length > 40) {
      await db.batch(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length > 0) {
    await db.batch(batch);
  }
}

async function encodeWithVapid(
  payload: PushPayload,
  subscription: { endpoint: string; p256dh: string; auth: string },
  vapid: TickOptions['vapid'],
): Promise<RequestInit | null> {
  if (!vapid) {
    return null;
  }
  const request = await buildPushPayload(
    { data: payload, options: { ttl: 60 * 60, urgency: 'normal' } },
    {
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    vapid,
  );
  return { method: request.method, headers: request.headers, body: request.body };
}

async function markSent(
  db: D1Database,
  row: DeliveryRow,
  status: number,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE push_deliveries
         SET status = 'sent', attempts = attempts + 1, last_status_code = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(status, now, row.id),
    db
      .prepare('UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0 WHERE id = ?')
      .bind(now, row.subscription_id),
  ]);
}

async function abandonSubscription(
  db: D1Database,
  row: DeliveryRow,
  status: number,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE push_deliveries
         SET status = 'abandoned', attempts = attempts + 1, last_status_code = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(status, `http_${status}`, now, row.id),
    db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.subscription_id),
  ]);
}

async function scheduleRetry(
  db: D1Database,
  row: DeliveryRow,
  status: number,
  now: number,
): Promise<void> {
  const attempts = row.attempts + 1;
  const delay = RETRY_AFTER[attempts - 1];
  const nextStatus = delay === undefined ? 'abandoned' : 'failed';
  const nextAttemptAt = delay === undefined ? now : now + delay;
  await db.batch([
    db
      .prepare(
        `UPDATE push_deliveries
         SET status = ?, attempts = ?, next_attempt_at = ?, last_status_code = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        nextStatus,
        attempts,
        nextAttemptAt,
        status === 0 ? null : status,
        status === 0 ? 'network' : `http_${status}`,
        now,
        row.id,
      ),
    db
      .prepare('UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?')
      .bind(row.subscription_id),
  ]);
}

function toItem(row: StoredNotification): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    path: resourcePath(row.resource_type, row.resource_id),
    readAt: row.read_at === null ? null : new Date(row.read_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
