import type { Context } from 'hono';
import { ApiError } from '../shared/errors';
import type {
  CalendarQuery,
  CreateRecurrenceInput,
  PatchRecurrenceInput,
  SuspendRecurrenceInput,
} from '../shared/schemas';
import type { CalendarItem, CalendarResponse, RecurrenceRule } from '../shared/recurrence';
import type { TaskPriority, TaskStatus } from '../shared/tasks';
import { auditStatement } from './audit';
import { loadSubscriptionMap, noticeStatements, taskNotice } from './notifications';
import { placeholders } from './profiles';
import {
  dueAtMillis,
  occurrenceDates,
  romeDayStart,
  romeToday,
  type RecurrenceFrequency,
  type RecurrenceSpec,
} from './recurrence-dates';
import { requireUser, type CurrentUser } from './session';
import type { AppEnv } from './types';

const NOT_FOUND = 'Risorsa non trovata.';
const FORBIDDEN = 'Non hai i permessi per questa operazione.';
const ASSIGNEES = 'Gli assegnatari devono essere membri attivi del gruppo.';
const ARCHIVED = 'Il gruppo è archiviato.';
const ALREADY_SUSPENDED = 'La regola è già sospesa.';
const NOT_SUSPENDED = 'La regola non è sospesa.';
const INSERT_LIMIT = 80;

type RuleRow = {
  id: string;
  group_id: string;
  group_name: string;
  created_by: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  frequency: RecurrenceFrequency;
  interval_count: number;
  weekdays: string | null;
  day_of_month: number | null;
  month_of_year: number | null;
  local_time: string;
  starts_on: string;
  ends_on: string | null;
  suspended_at: number | null;
  created_at: number;
  updated_at: number;
};

const RULE_COLUMNS = `r.id, r.group_id, g.name AS group_name, r.created_by, r.title, r.description,
  r.priority, r.frequency, r.interval_count, r.weekdays, r.day_of_month, r.month_of_year,
  r.local_time, r.starts_on, r.ends_on, r.suspended_at, r.created_at, r.updated_at`;

export async function listRecurrences(c: Context<AppEnv>): Promise<{ items: RecurrenceRule[] }> {
  const user = await requireUser(c);
  assertManager(user);
  if (user.role !== 'admin' && user.groups.length === 0) {
    return { items: [] };
  }
  const where: string[] = [];
  const binds: string[] = [];
  if (user.role !== 'admin') {
    const ids = user.groups.map((group) => group.id);
    where.push(`r.group_id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT ${RULE_COLUMNS}
     FROM recurrence_rules r
     JOIN groups g ON g.id = r.group_id
     ${clause}
     ORDER BY r.suspended_at IS NOT NULL, r.title COLLATE NOCASE`,
  )
    .bind(...binds)
    .all<RuleRow>();
  const assignees = await loadAssignees(
    c.env.DB,
    rows.results.map((row) => row.id),
  );
  return { items: rows.results.map((row) => toRule(row, assignees.get(row.id) ?? [])) };
}

export async function createRecurrence(
  c: Context<AppEnv>,
  input: CreateRecurrenceInput,
): Promise<RecurrenceRule> {
  const actor = await requireUser(c);
  if (!seesGroup(actor, input.groupId)) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  assertManager(actor);
  const db = c.env.DB;
  const group = await db
    .prepare('SELECT id, status FROM groups WHERE id = ?')
    .bind(input.groupId)
    .first<{ id: string; status: string }>();
  if (!group) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (group.status !== 'active') {
    throw new ApiError(409, 'conflict', ARCHIVED);
  }
  await assertActiveMembers(db, input.groupId, input.assigneeIds);
  const now = Date.now();
  const id = crypto.randomUUID();
  const fields = storedFields(input);
  await db.batch([
    db
      .prepare(
        `INSERT INTO recurrence_rules (
           id, group_id, created_by, title, description, priority, frequency, interval_count,
           weekdays, day_of_month, month_of_year, local_time, starts_on, ends_on, suspended_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        id,
        input.groupId,
        actor.id,
        input.title,
        blankToNull(input.description),
        input.priority,
        input.frequency,
        input.intervalCount,
        fields.weekdays,
        fields.dayOfMonth,
        fields.monthOfYear,
        input.localTime,
        input.startsOn,
        input.endsOn ?? null,
        now,
        now,
      ),
    ...input.assigneeIds.map((userId) => assigneeInsert(db, id, userId)),
    auditStatement(db, {
      actorId: actor.id,
      action: 'recurrence.created',
      entityType: 'recurrence_rule',
      entityId: id,
      metadata: { frequency: input.frequency },
      createdAt: now,
    }),
  ]);
  return readVisible(db, actor, id);
}

export async function getRecurrence(c: Context<AppEnv>, ruleId: string): Promise<RecurrenceRule> {
  const user = await requireUser(c);
  return readVisible(c.env.DB, user, ruleId);
}

export async function updateRecurrence(
  c: Context<AppEnv>,
  ruleId: string,
  input: PatchRecurrenceInput,
): Promise<RecurrenceRule> {
  const actor = await requireUser(c);
  const current = await visibleRow(c.env.DB, actor, ruleId);
  assertManager(actor);
  await assertActiveMembers(c.env.DB, current.group_id, input.assigneeIds);
  const now = Date.now();
  const fields = storedFields(input);
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM recurrence_assignees WHERE rule_id = ?').bind(current.id),
    ...input.assigneeIds.map((userId) => assigneeInsert(db, current.id, userId)),
    db
      .prepare(
        `UPDATE recurrence_rules
         SET title = ?, description = ?, priority = ?, frequency = ?, interval_count = ?,
             weekdays = ?, day_of_month = ?, month_of_year = ?, local_time = ?, starts_on = ?,
             ends_on = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.title,
        blankToNull(input.description),
        input.priority,
        input.frequency,
        input.intervalCount,
        fields.weekdays,
        fields.dayOfMonth,
        fields.monthOfYear,
        input.localTime,
        input.startsOn,
        input.endsOn ?? null,
        now,
        current.id,
      ),
    auditStatement(db, {
      actorId: actor.id,
      action: 'recurrence.updated',
      entityType: 'recurrence_rule',
      entityId: current.id,
      metadata: { frequency: input.frequency },
      createdAt: now,
    }),
  ]);
  return readVisible(db, actor, current.id);
}

export async function suspendRecurrence(
  c: Context<AppEnv>,
  ruleId: string,
  input: SuspendRecurrenceInput,
): Promise<RecurrenceRule> {
  const actor = await requireUser(c);
  const current = await visibleRow(c.env.DB, actor, ruleId);
  assertManager(actor);
  if (current.suspended_at !== null) {
    throw new ApiError(409, 'conflict', ALREADY_SUSPENDED);
  }
  const now = Date.now();
  const today = romeToday(now);
  const db = c.env.DB;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        'UPDATE recurrence_rules SET suspended_at = ?, updated_at = ? WHERE id = ? AND suspended_at IS NULL',
      )
      .bind(now, now, current.id),
    auditStatement(db, {
      actorId: actor.id,
      action: 'recurrence.suspended',
      entityType: 'recurrence_rule',
      entityId: current.id,
      metadata: { cancelFutureOpen: input.cancelFutureOpen ? 'true' : 'false' },
      createdAt: now,
    }),
  ];
  if (input.cancelFutureOpen) {
    const open = await db
      .prepare(
        `SELECT id FROM tasks
         WHERE recurrence_rule_id = ? AND status IN ('todo', 'in_progress') AND occurrence_local_date > ?`,
      )
      .bind(current.id, today)
      .all<{ id: string }>();
    for (const row of open.results) {
      statements.push(
        db
          .prepare(
            `UPDATE tasks
             SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = ?
             WHERE id = ? AND status IN ('todo', 'in_progress')`,
          )
          .bind(now, actor.id, now, row.id),
        db
          .prepare(
            `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at)
             SELECT ?, ?, 'task.cancelled', 'task', ?, ?, ?
             WHERE changes() > 0`,
          )
          .bind(
            crypto.randomUUID(),
            actor.id,
            row.id,
            JSON.stringify({ source: 'recurrence' }),
            now,
          ),
      );
    }
  }
  await db.batch(statements);
  return readVisible(db, actor, current.id);
}

export async function resumeRecurrence(
  c: Context<AppEnv>,
  ruleId: string,
): Promise<RecurrenceRule> {
  const actor = await requireUser(c);
  const current = await visibleRow(c.env.DB, actor, ruleId);
  assertManager(actor);
  if (current.suspended_at === null) {
    throw new ApiError(409, 'conflict', NOT_SUSPENDED);
  }
  const now = Date.now();
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        'UPDATE recurrence_rules SET suspended_at = NULL, updated_at = ? WHERE id = ? AND suspended_at IS NOT NULL',
      )
      .bind(now, current.id),
    auditStatement(db, {
      actorId: actor.id,
      action: 'recurrence.resumed',
      entityType: 'recurrence_rule',
      entityId: current.id,
      createdAt: now,
    }),
  ]);
  return readVisible(db, actor, current.id);
}

export async function loadCalendar(
  c: Context<AppEnv>,
  query: CalendarQuery,
): Promise<CalendarResponse> {
  const user = await requireUser(c);
  if (
    query.groupId &&
    user.role !== 'admin' &&
    !user.groups.some((group) => group.id === query.groupId)
  ) {
    return { from: query.from, to: query.to, items: [] };
  }
  if (user.role !== 'admin' && user.groups.length === 0) {
    return { from: query.from, to: query.to, items: [] };
  }
  const where = ['t.due_at >= ?', 't.due_at < ?'];
  const binds: (string | number)[] = [romeDayStart(query.from), romeDayStart(addDays(query.to, 1))];
  if (user.role !== 'admin') {
    const ids = user.groups.map((group) => group.id);
    where.push(`t.group_id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  }
  if (query.groupId) {
    where.push('t.group_id = ?');
    binds.push(query.groupId);
  }
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.priority, t.due_at, g.name AS group_name, t.occurrence_local_date
     FROM tasks t
     JOIN groups g ON g.id = t.group_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.due_at, t.title COLLATE NOCASE
     LIMIT 200`,
  )
    .bind(...binds)
    .all<{
      id: string;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
      due_at: number;
      group_name: string;
      occurrence_local_date: string | null;
    }>();
  const items: CalendarItem[] = rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueAt: new Date(row.due_at).toISOString(),
    localDate: romeToday(row.due_at),
    groupName: row.group_name,
    occurrenceLocalDate: row.occurrence_local_date,
  }));
  return { from: query.from, to: query.to, items };
}

export async function generateOccurrences(db: D1Database, now: number): Promise<number> {
  const today = romeToday(now);
  const rules = await db
    .prepare(
      `SELECT ${RULE_COLUMNS}
       FROM recurrence_rules r
       JOIN groups g ON g.id = r.group_id AND g.status = 'active'
       WHERE r.suspended_at IS NULL AND r.starts_on <= ?
       ORDER BY r.created_at, r.id`,
    )
    .bind(today)
    .all<RuleRow>();
  if (rules.results.length === 0) {
    return 0;
  }
  const ids = rules.results.map((row) => row.id);
  const [existingResult, assigneeResult] = await db.batch([
    db
      .prepare(
        `SELECT recurrence_rule_id, occurrence_local_date
         FROM tasks
         WHERE recurrence_rule_id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids),
    db
      .prepare(
        `SELECT a.rule_id, a.user_id
         FROM recurrence_assignees a
         JOIN recurrence_rules r ON r.id = a.rule_id
         JOIN users u ON u.id = a.user_id AND u.status = 'active'
         JOIN group_members m ON m.user_id = a.user_id AND m.group_id = r.group_id
         WHERE a.rule_id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids),
  ]);
  const existing = new Set(
    (
      (existingResult?.results ?? []) as {
        recurrence_rule_id: string;
        occurrence_local_date: string;
      }[]
    ).map((row) => `${row.recurrence_rule_id}|${row.occurrence_local_date}`),
  );
  const assignees = new Map<string, string[]>();
  for (const row of (assigneeResult?.results ?? []) as { rule_id: string; user_id: string }[]) {
    const current = assignees.get(row.rule_id) ?? [];
    current.push(row.user_id);
    assignees.set(row.rule_id, current);
  }
  const subscriptions = await loadSubscriptionMap(db, [...new Set([...assignees.values()].flat())]);

  const groups: D1PreparedStatement[][] = [];
  let planned = 0;
  for (const rule of rules.results) {
    if (planned >= INSERT_LIMIT) {
      break;
    }
    const dates = occurrenceDates(specOf(rule), today);
    for (const date of dates) {
      if (planned >= INSERT_LIMIT) {
        break;
      }
      if (existing.has(`${rule.id}|${date}`)) {
        continue;
      }
      const taskId = crypto.randomUUID();
      const statements = [
        db
          .prepare(
            `INSERT OR IGNORE INTO tasks (
               id, title, description, group_id, created_by, priority, status, due_at,
               completed_at, completed_by, cancelled_at, cancelled_by, claimed_by, claimed_at,
               recurrence_rule_id, occurrence_local_date, recurrence_detached, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, 0, ?, ?)`,
          )
          .bind(
            taskId,
            rule.title,
            rule.description,
            rule.group_id,
            rule.created_by,
            rule.priority,
            dueAtMillis(date, rule.local_time),
            rule.id,
            date,
            now,
            now,
          ),
        db
          .prepare(
            `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at)
             SELECT ?, NULL, 'task.created', 'task', id, ?, ?
             FROM tasks WHERE id = ?`,
          )
          .bind(
            crypto.randomUUID(),
            JSON.stringify({ source: 'recurrence', ruleId: rule.id, date }),
            now,
            taskId,
          ),
      ];
      const people = assignees.get(rule.id) ?? [];
      for (const userId of people) {
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO task_assignees (task_id, user_id, assigned_by, assigned_at)
               SELECT ?, ?, ?, ?
               WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)`,
            )
            .bind(taskId, userId, rule.created_by, now, taskId),
        );
      }
      statements.push(
        ...noticeStatements(
          db,
          people.map((userId) => taskNotice(userId, 'task_assigned', rule.title, taskId)),
          subscriptions,
          now,
          { kind: 'task', taskId },
        ),
      );
      groups.push(statements);
      planned += 1;
    }
  }
  await runGrouped(db, groups);
  return planned;
}

async function readVisible(
  db: D1Database,
  user: CurrentUser,
  ruleId: string,
): Promise<RecurrenceRule> {
  const row = await visibleRow(db, user, ruleId);
  assertManager(user);
  const assignees = await loadAssignees(db, [row.id]);
  return toRule(row, assignees.get(row.id) ?? []);
}

async function visibleRow(db: D1Database, user: CurrentUser, ruleId: string): Promise<RuleRow> {
  const row = await db
    .prepare(
      `SELECT ${RULE_COLUMNS}
       FROM recurrence_rules r
       JOIN groups g ON g.id = r.group_id
       WHERE r.id = ?`,
    )
    .bind(ruleId)
    .first<RuleRow>();
  if (!row || !seesGroup(user, row.group_id)) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return row;
}

function assertManager(user: CurrentUser): void {
  if (user.role === 'volunteer') {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
}

function seesGroup(user: CurrentUser, groupId: string): boolean {
  return user.role === 'admin' || user.groups.some((group) => group.id === groupId);
}

async function assertActiveMembers(
  db: D1Database,
  groupId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const found = await db
    .prepare(
      `SELECT u.id
       FROM users u
       JOIN group_members m ON m.user_id = u.id AND m.group_id = ?
       WHERE u.status = 'active' AND u.id IN (${placeholders(userIds.length)})`,
    )
    .bind(groupId, ...userIds)
    .all<{ id: string }>();
  if (found.results.length !== userIds.length) {
    throw new ApiError(400, 'validation_error', ASSIGNEES);
  }
}

async function loadAssignees(
  db: D1Database,
  ruleIds: readonly string[],
): Promise<Map<string, { id: string; fullName: string }[]>> {
  const grouped = new Map<string, { id: string; fullName: string }[]>();
  if (ruleIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .prepare(
      `SELECT a.rule_id, u.id, u.full_name
       FROM recurrence_assignees a
       JOIN users u ON u.id = a.user_id
       WHERE a.rule_id IN (${placeholders(ruleIds.length)})
       ORDER BY u.full_name COLLATE NOCASE`,
    )
    .bind(...ruleIds)
    .all<{ rule_id: string; id: string; full_name: string }>();
  for (const row of rows.results) {
    const current = grouped.get(row.rule_id) ?? [];
    current.push({ id: row.id, fullName: row.full_name });
    grouped.set(row.rule_id, current);
  }
  return grouped;
}

function assigneeInsert(db: D1Database, ruleId: string, userId: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO recurrence_assignees (rule_id, user_id) VALUES (?, ?)')
    .bind(ruleId, userId);
}

function storedFields(input: {
  frequency: RecurrenceFrequency;
  weekdays?: number[] | undefined;
  dayOfMonth?: number | undefined;
  monthOfYear?: number | undefined;
}): { weekdays: string | null; dayOfMonth: number | null; monthOfYear: number | null } {
  return {
    weekdays:
      input.frequency === 'weekly'
        ? JSON.stringify([...(input.weekdays ?? [])].sort((left, right) => left - right))
        : null,
    dayOfMonth:
      input.frequency === 'monthly' || input.frequency === 'yearly'
        ? (input.dayOfMonth ?? null)
        : null,
    monthOfYear: input.frequency === 'yearly' ? (input.monthOfYear ?? null) : null,
  };
}

function specOf(row: RuleRow): RecurrenceSpec {
  return {
    frequency: row.frequency,
    intervalCount: row.interval_count,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    dayOfMonth: row.day_of_month,
    monthOfYear: row.month_of_year,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  };
}

function toRule(row: RuleRow, assignees: { id: string; fullName: string }[]): RecurrenceRule {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    title: row.title,
    description: row.description,
    priority: row.priority,
    frequency: row.frequency,
    intervalCount: row.interval_count,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    dayOfMonth: row.day_of_month,
    monthOfYear: row.month_of_year,
    localTime: row.local_time,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    suspendedAt: row.suspended_at === null ? null : new Date(row.suspended_at).toISOString(),
    assignees,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function addDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate).add({ days }).toString();
}

async function runGrouped(db: D1Database, groups: D1PreparedStatement[][]): Promise<void> {
  let batch: D1PreparedStatement[] = [];
  for (const group of groups) {
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
