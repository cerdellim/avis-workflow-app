import type { Context } from 'hono';
import type { UserStatus } from '../shared/account';
import { ApiError } from '../shared/errors';
import type { CreateTaskInput, PatchTaskInput, TaskListQuery } from '../shared/schemas';
import type { TaskChecklist, TaskChecklistRun } from '../shared/checklists';
import type { TaskAssignee, TaskList, TaskPriority, TaskRecord, TaskStatus } from '../shared/tasks';
import { auditStatement } from './audit';
import { assertActiveTemplates, checklistLinkInsert } from './checklists';
import { coordinatorIds, loadSubscriptionMap, noticeStatements, taskNotice } from './notifications';
import { changed, placeholders } from './profiles';
import { requireUser, type CurrentUser } from './session';
import type { AppEnv } from './types';

const NOT_FOUND = 'Risorsa non trovata.';
const FORBIDDEN = 'Non hai i permessi per questa operazione.';
const CONFLICT = "Lo stato dell'attività è cambiato. Aggiorna la pagina.";
const ASSIGNEES = 'Gli assegnatari devono essere membri attivi del gruppo.';
const ARCHIVED = 'Il gruppo è archiviato.';

const SORTS: Record<NonNullable<TaskListQuery['sort']>, readonly string[]> = {
  dueAt: ['CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END', 't.due_at'],
  priority: [
    "CASE t.priority WHEN 'low' THEN 1 WHEN 'normal' THEN 2 WHEN 'high' THEN 3 ELSE 4 END",
  ],
  createdAt: ['t.created_at'],
  title: ['t.title COLLATE NOCASE'],
  status: ['t.status'],
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  group_id: string;
  group_name: string;
  created_by: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: number | null;
  completed_at: number | null;
  completed_by: string | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  recurrence_rule_id: string | null;
  occurrence_local_date: string | null;
  recurrence_detached: number;
  created_at: number;
  updated_at: number;
};

type AssigneeRow = {
  task_id: string;
  id: string;
  full_name: string;
  email: string;
  status: UserStatus;
};

const TASK_COLUMNS = `t.id, t.title, t.description, t.group_id, g.name AS group_name, t.created_by,
  t.priority, t.status, t.due_at, t.completed_at, t.completed_by, t.cancelled_at, t.cancelled_by,
  t.claimed_by, t.claimed_at, t.recurrence_rule_id, t.occurrence_local_date, t.recurrence_detached,
  t.created_at, t.updated_at`;

export async function listTasks(c: Context<AppEnv>, query: TaskListQuery): Promise<TaskList> {
  const user = await requireUser(c);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  if (user.role !== 'admin' && user.groups.length === 0) {
    return { items: [], page, pageSize, total: 0 };
  }
  if (
    query.groupId &&
    user.role !== 'admin' &&
    !user.groups.some((group) => group.id === query.groupId)
  ) {
    return { items: [], page, pageSize, total: 0 };
  }

  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (user.role !== 'admin') {
    const ids = user.groups.map((group) => group.id);
    where.push(`t.group_id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  }
  if (query.groupId) {
    where.push('t.group_id = ?');
    binds.push(query.groupId);
  }
  if (query.status) {
    where.push('t.status = ?');
    binds.push(query.status);
  }
  if (query.priority) {
    where.push('t.priority = ?');
    binds.push(query.priority);
  }
  if (query.assigneeId) {
    where.push(
      'EXISTS (SELECT 1 FROM task_assignees filter_assignee WHERE filter_assignee.task_id = t.id AND filter_assignee.user_id = ?)',
    );
    binds.push(query.assigneeId);
  }
  if (query.dueFrom) {
    where.push('t.due_at >= ?');
    binds.push(Date.parse(query.dueFrom));
  }
  if (query.dueTo) {
    where.push('t.due_at <= ?');
    binds.push(Date.parse(query.dueTo));
  }
  if (query.q && query.q.length > 0) {
    const pattern = likePattern(query.q);
    where.push("(t.title LIKE ? ESCAPE '\\' OR IFNULL(t.description, '') LIKE ? ESCAPE '\\')");
    binds.push(pattern, pattern);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sort = SORTS[query.sort ?? 'dueAt'];
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
  const order = `${sort.map((part) => `${part} ${direction}`).join(', ')}, t.id ASC`;
  const db = c.env.DB;
  const [countResult, listResult] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM tasks t ${clause}`).bind(...binds),
    db
      .prepare(
        `SELECT ${TASK_COLUMNS}
         FROM tasks t
         JOIN groups g ON g.id = t.group_id
         ${clause}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize),
  ]);
  const total = numberOf(countResult?.results[0], 'n');
  const rows = (listResult?.results ?? []) as TaskRow[];
  const ids = rows.map((row) => row.id);
  const assignees = await loadAssignees(db, ids);
  const checklists = await loadChecklists(db, ids);
  return {
    items: rows.map((row) =>
      toRecord(row, assignees.get(row.id) ?? [], checklists.get(row.id) ?? []),
    ),
    page,
    pageSize,
    total,
  };
}

export async function createTask(c: Context<AppEnv>, input: CreateTaskInput): Promise<TaskRecord> {
  const actor = await requireUser(c);
  if (!seesGroup(actor, input.groupId)) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (actor.role === 'volunteer') {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
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
  const templateIds = input.checklistTemplateIds ?? [];
  await assertActiveTemplates(db, input.groupId, templateIds);
  const recipients = input.assigneeIds.filter((userId) => userId !== actor.id);
  const subscriptions = await loadSubscriptionMap(db, recipients);
  const now = Date.now();
  const id = crypto.randomUUID();
  const description = blankToNull(input.description);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO tasks (
           id, title, description, group_id, created_by, priority, status, due_at,
           completed_at, completed_by, cancelled_at, cancelled_by, claimed_by, claimed_at,
           recurrence_rule_id, occurrence_local_date, recurrence_detached, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?)`,
      )
      .bind(
        id,
        input.title,
        description,
        input.groupId,
        actor.id,
        input.priority,
        millis(input.dueAt),
        now,
        now,
      ),
  ];
  for (const userId of input.assigneeIds) {
    statements.push(assigneeInsert(db, id, userId, actor.id, now));
  }
  templateIds.forEach((templateId, position) => {
    statements.push(checklistLinkInsert(db, id, templateId, position));
  });
  statements.push(
    auditStatement(db, {
      actorId: actor.id,
      action: 'task.created',
      entityType: 'task',
      entityId: id,
      metadata: { status: 'todo', priority: input.priority },
      createdAt: now,
    }),
    ...noticeStatements(
      db,
      recipients.map((userId) => taskNotice(userId, 'task_assigned', input.title, id)),
      subscriptions,
      now,
      { kind: 'always' },
    ),
  );
  await db.batch(statements);
  return readVisible(db, actor, id);
}

export async function getTask(c: Context<AppEnv>, taskId: string): Promise<TaskRecord> {
  const user = await requireUser(c);
  return readVisible(c.env.DB, user, taskId);
}

export async function updateTask(
  c: Context<AppEnv>,
  taskId: string,
  input: PatchTaskInput,
): Promise<TaskRecord> {
  const actor = await requireUser(c);
  const current = await visibleRow(c.env.DB, actor, taskId);
  if (actor.role === 'volunteer') {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const db = c.env.DB;
  await assertActiveMembers(db, current.group_id, input.assigneeIds);
  if (input.checklistTemplateIds !== undefined) {
    await assertActiveTemplates(db, current.group_id, input.checklistTemplateIds, current.id);
  }
  const previous = new Set(await assigneeIds(db, current.id));
  const added = input.assigneeIds.filter((userId) => userId !== actor.id && !previous.has(userId));
  const subscriptions = await loadSubscriptionMap(db, added);
  const now = Date.now();
  const description = blankToNull(input.description);
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').bind(current.id),
  ];
  for (const userId of input.assigneeIds) {
    statements.push(assigneeInsert(db, current.id, userId, actor.id, now));
  }
  if (input.checklistTemplateIds !== undefined) {
    statements.push(db.prepare('DELETE FROM task_checklists WHERE task_id = ?').bind(current.id));
    input.checklistTemplateIds.forEach((templateId, position) => {
      statements.push(checklistLinkInsert(db, current.id, templateId, position));
    });
  }
  const updateIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE tasks
         SET title = ?, description = ?, priority = ?, due_at = ?, updated_at = ?,
             recurrence_detached = CASE WHEN recurrence_rule_id IS NULL THEN recurrence_detached ELSE 1 END
         WHERE id = ?`,
      )
      .bind(input.title, description, input.priority, millis(input.dueAt), now, current.id),
    auditAfterChange(db, actor.id, 'task.updated', current.id, now, { priority: input.priority }),
    ...noticeStatements(
      db,
      added.map((userId) => taskNotice(userId, 'task_assigned', input.title, current.id)),
      subscriptions,
      now,
      { kind: 'always' },
    ),
  );
  await runWrite(db, statements, updateIndex);
  return readVisible(db, actor, current.id);
}

export async function claimTask(c: Context<AppEnv>, taskId: string): Promise<TaskRecord> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const current = await visibleRow(db, actor, taskId);
  assertStatus(current, ['todo']);
  const assignees = await assigneeIds(db, current.id);
  if (!canClaim(actor, current, assignees)) {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const now = Date.now();
  await runWrite(db, [
    db
      .prepare(
        `UPDATE tasks
         SET status = 'in_progress', claimed_by = ?, claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'todo'`,
      )
      .bind(actor.id, now, now, current.id),
    auditAfterChange(db, actor.id, 'task.claimed', current.id, now),
  ]);
  return readVisible(db, actor, current.id);
}

export async function releaseTask(c: Context<AppEnv>, taskId: string): Promise<TaskRecord> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const current = await visibleRow(db, actor, taskId);
  assertStatus(current, ['in_progress']);
  if (actor.role === 'volunteer' && current.claimed_by !== actor.id) {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const now = Date.now();
  await runWrite(db, [
    db
      .prepare(
        `UPDATE tasks
         SET status = 'todo', claimed_by = NULL, claimed_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'in_progress'`,
      )
      .bind(now, current.id),
    auditAfterChange(db, actor.id, 'task.released', current.id, now),
  ]);
  return readVisible(db, actor, current.id);
}

export async function completeTask(c: Context<AppEnv>, taskId: string): Promise<TaskRecord> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const current = await visibleRow(db, actor, taskId);
  assertStatus(current, ['todo', 'in_progress']);
  const assignees = await assigneeIds(db, current.id);
  if (!canComplete(actor, current, assignees)) {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  await assertChecklistsCompleted(db, current.id);
  const coordinators = await coordinatorIds(db, current.group_id, actor.id);
  const subscriptions = await loadSubscriptionMap(db, coordinators);
  const now = Date.now();
  await runWrite(db, [
    db
      .prepare(
        `UPDATE tasks
         SET status = 'completed', completed_at = ?, completed_by = ?, updated_at = ?
         WHERE id = ? AND status IN ('todo', 'in_progress')`,
      )
      .bind(now, actor.id, now, current.id),
    auditAfterChange(db, actor.id, 'task.completed', current.id, now),
    ...noticeStatements(
      db,
      coordinators.map((userId) => taskNotice(userId, 'task_completed', current.title, current.id)),
      subscriptions,
      now,
      { kind: 'changes' },
    ),
  ]);
  return readVisible(db, actor, current.id);
}

export async function reopenTask(c: Context<AppEnv>, taskId: string): Promise<TaskRecord> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const current = await visibleRow(db, actor, taskId);
  assertStatus(current, ['completed']);
  requireManager(actor);
  const now = Date.now();
  await runWrite(db, [
    db
      .prepare(
        `UPDATE tasks
         SET status = 'in_progress', completed_at = NULL, completed_by = NULL,
             claimed_by = ?, claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'completed'`,
      )
      .bind(actor.id, now, now, current.id),
    auditAfterChange(db, actor.id, 'task.reopened', current.id, now),
  ]);
  return readVisible(db, actor, current.id);
}

export async function cancelTask(c: Context<AppEnv>, taskId: string): Promise<TaskRecord> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const current = await visibleRow(db, actor, taskId);
  assertStatus(current, ['todo', 'in_progress']);
  requireManager(actor);
  const now = Date.now();
  await runWrite(db, [
    db
      .prepare(
        `UPDATE tasks
         SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = ?
         WHERE id = ? AND status IN ('todo', 'in_progress')`,
      )
      .bind(now, actor.id, now, current.id),
    auditAfterChange(db, actor.id, 'task.cancelled', current.id, now),
  ]);
  return readVisible(db, actor, current.id);
}

export async function taskHistory(
  c: Context<AppEnv>,
  taskId: string,
): Promise<{
  items: {
    id: string;
    actorId: string | null;
    actorName: string | null;
    action: string;
    createdAt: string;
    metadata: Record<string, string> | null;
  }[];
}> {
  const user = await requireUser(c);
  await visibleRow(c.env.DB, user, taskId);
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action, a.metadata, a.created_at
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.entity_type = 'task' AND a.entity_id = ?
     ORDER BY a.created_at ASC, a.id ASC`,
  )
    .bind(taskId)
    .all<{
      id: string;
      actor_id: string | null;
      actor_name: string | null;
      action: string;
      metadata: string | null;
      created_at: number;
    }>();
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      createdAt: new Date(row.created_at).toISOString(),
      metadata: readMetadata(row.metadata),
    })),
  };
}

function seesGroup(user: CurrentUser, groupId: string): boolean {
  return user.role === 'admin' || user.groups.some((group) => group.id === groupId);
}

function requireManager(user: CurrentUser): void {
  if (user.role === 'volunteer') {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
}

function assertStatus(task: TaskRow, allowed: readonly TaskStatus[]): void {
  if (!allowed.includes(task.status)) {
    throw new ApiError(409, 'conflict', CONFLICT);
  }
}

function canClaim(user: CurrentUser, task: TaskRow, assignees: readonly string[]): boolean {
  if (user.role !== 'volunteer') {
    return seesGroup(user, task.group_id);
  }
  if (assignees.includes(user.id)) {
    return true;
  }
  return assignees.length === 0 && seesGroup(user, task.group_id);
}

function canComplete(user: CurrentUser, task: TaskRow, assignees: readonly string[]): boolean {
  if (user.role !== 'volunteer') {
    return seesGroup(user, task.group_id);
  }
  return assignees.includes(user.id) || task.claimed_by === user.id;
}

async function visibleRow(db: D1Database, user: CurrentUser, taskId: string): Promise<TaskRow> {
  const row = await db
    .prepare(
      `SELECT ${TASK_COLUMNS}
       FROM tasks t
       JOIN groups g ON g.id = t.group_id
       WHERE t.id = ?`,
    )
    .bind(taskId)
    .first<TaskRow>();
  if (!row || !seesGroup(user, row.group_id)) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return row;
}

async function readVisible(db: D1Database, user: CurrentUser, taskId: string): Promise<TaskRecord> {
  const row = await visibleRow(db, user, taskId);
  const assignees = await loadAssignees(db, [row.id]);
  const checklists = await loadChecklists(db, [row.id]);
  return toRecord(row, assignees.get(row.id) ?? [], checklists.get(row.id) ?? []);
}

async function assertChecklistsCompleted(db: D1Database, taskId: string): Promise<void> {
  const missing = await db
    .prepare(
      `SELECT tpl.title
       FROM task_checklists link
       JOIN checklist_templates tpl ON tpl.id = link.template_id
       WHERE link.task_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM checklist_runs run
           WHERE run.task_id = link.task_id
             AND run.template_id = link.template_id
             AND run.status = 'completed'
         )
       ORDER BY link.position ASC`,
    )
    .bind(taskId)
    .all<{ title: string }>();
  if (missing.results.length === 0) {
    return;
  }
  const titles = missing.results.map((row) => row.title).join(', ');
  throw new ApiError(
    409,
    'conflict',
    `Prima di concludere l'attività completa la checklist collegata: ${titles}.`,
  );
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

async function assigneeIds(db: D1Database, taskId: string): Promise<string[]> {
  const rows = await db
    .prepare('SELECT user_id FROM task_assignees WHERE task_id = ?')
    .bind(taskId)
    .all<{ user_id: string }>();
  return rows.results.map((row) => row.user_id);
}

async function loadAssignees(
  db: D1Database,
  taskIds: readonly string[],
): Promise<Map<string, TaskAssignee[]>> {
  const grouped = new Map<string, TaskAssignee[]>();
  if (taskIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .prepare(
      `SELECT a.task_id, u.id, u.full_name, u.email, u.status
       FROM task_assignees a
       JOIN users u ON u.id = a.user_id
       WHERE a.task_id IN (${placeholders(taskIds.length)})
       ORDER BY u.full_name COLLATE NOCASE`,
    )
    .bind(...taskIds)
    .all<AssigneeRow>();
  for (const row of rows.results) {
    const current = grouped.get(row.task_id) ?? [];
    current.push({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      status: row.status,
    });
    grouped.set(row.task_id, current);
  }
  return grouped;
}

function assigneeInsert(
  db: D1Database,
  taskId: string,
  userId: string,
  actorId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(taskId, userId, actorId, now);
}

function auditAfterChange(
  db: D1Database,
  actorId: string,
  action: string,
  taskId: string,
  now: number,
  metadata?: Record<string, string>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at)
       SELECT ?, ?, ?, 'task', ?, ?, ?
       WHERE changes() > 0`,
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      taskId,
      metadata ? JSON.stringify(metadata) : null,
      now,
    );
}

async function runWrite(
  db: D1Database,
  statements: D1PreparedStatement[],
  updateIndex = 0,
): Promise<void> {
  try {
    const results = await db.batch(statements);
    if (changed(results[updateIndex]) === 0) {
      throw new ApiError(409, 'conflict', CONFLICT);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(409, 'conflict', CONFLICT);
  }
}

async function loadChecklists(
  db: D1Database,
  taskIds: readonly string[],
): Promise<Map<string, TaskChecklist[]>> {
  const grouped = new Map<string, TaskChecklist[]>();
  if (taskIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .prepare(
      `SELECT link.task_id, tpl.id AS template_id, tpl.title, tpl.status,
              run.id AS run_id, run.status AS run_status, run.outcome
       FROM task_checklists link
       JOIN checklist_templates tpl ON tpl.id = link.template_id
       LEFT JOIN checklist_runs run ON run.id = (
         SELECT candidate.id
         FROM checklist_runs candidate
         WHERE candidate.task_id = link.task_id
           AND candidate.template_id = link.template_id
           AND candidate.status != 'cancelled'
         ORDER BY CASE candidate.status WHEN 'in_progress' THEN 0 ELSE 1 END, candidate.started_at DESC
         LIMIT 1
       )
       WHERE link.task_id IN (${placeholders(taskIds.length)})
       ORDER BY link.position ASC`,
    )
    .bind(...taskIds)
    .all<{
      task_id: string;
      template_id: string;
      title: string;
      status: 'active' | 'inactive';
      run_id: string | null;
      run_status: TaskChecklistRun['status'] | null;
      outcome: TaskChecklistRun['outcome'] | null;
    }>();
  for (const row of rows.results) {
    const current = grouped.get(row.task_id) ?? [];
    const run =
      row.run_id && row.run_status
        ? { id: row.run_id, status: row.run_status, outcome: row.outcome }
        : null;
    current.push({
      templateId: row.template_id,
      title: row.title,
      status: row.status,
      run,
    });
    grouped.set(row.task_id, current);
  }
  return grouped;
}

function toRecord(
  row: TaskRow,
  assignees: TaskAssignee[],
  checklists: TaskChecklist[],
): TaskRecord {
  const recurrence =
    row.recurrence_rule_id && row.occurrence_local_date
      ? {
          ruleId: row.recurrence_rule_id,
          occurrenceLocalDate: row.occurrence_local_date,
          detached: row.recurrence_detached === 1,
        }
      : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    groupId: row.group_id,
    groupName: row.group_name,
    createdBy: row.created_by,
    priority: row.priority,
    status: row.status,
    dueAt: iso(row.due_at),
    completedAt: iso(row.completed_at),
    completedBy: row.completed_by,
    cancelledAt: iso(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    claimedBy: row.claimed_by,
    claimedAt: iso(row.claimed_at),
    recurrence,
    assignees,
    checklists,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function readMetadata(value: string | null): Record<string, string> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const metadata: Record<string, string> = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item === 'string') {
        metadata[key] = item;
      }
    }
    return metadata;
  } catch {
    return null;
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function millis(value: string | null): number | null {
  return value === null ? null : Date.parse(value);
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function numberOf(row: unknown, key: string): number {
  if (typeof row !== 'object' || row === null || !(key in row)) {
    return 0;
  }
  const parsed = Number((row as Record<string, unknown>)[key] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
