import type { Context } from 'hono';
import type {
  ChecklistItemResult,
  ChecklistOutcome,
  ChecklistRun,
  ChecklistRunItem,
  ChecklistRunStatus,
  ChecklistRunSummary,
  ChecklistTemplate,
  ChecklistTemplateStatus,
  ChecklistTemplateSummary,
} from '../shared/checklists';
import { ApiError } from '../shared/errors';
import type {
  ChecklistListQuery,
  CreateChecklistInput,
  PatchChecklistInput,
  PatchChecklistItemInput,
  StartChecklistRunInput,
} from '../shared/schemas';
import { auditStatement } from './audit';
import {
  checklistNotice,
  coordinatorIds,
  loadSubscriptionMap,
  noticeStatements,
} from './notifications';
import { changed, placeholders } from './profiles';
import { requireUser, type CurrentUser } from './session';
import type { AppEnv } from './types';

const NOT_FOUND = 'Risorsa non trovata.';
const FORBIDDEN = 'Non hai i permessi per questa operazione.';
const CONFLICT = "Lo stato dell'esecuzione è cambiato. Aggiorna la pagina.";
const INACTIVE = 'Il modello non è attivo.';
const OPEN_RUN = "C'è già un'esecuzione aperta di questa checklist per l'attività.";
const CLOSE_RULE =
  'Le voci obbligatorie devono essere conformi o non conformi. «Non applicabile» vale solo per le facoltative.';
const SAME_GROUP = "L'attività e la checklist devono appartenere allo stesso gruppo.";

type TemplateRow = {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  description: string | null;
  status: ChecklistTemplateStatus;
  created_at: number;
  updated_at: number;
  item_count: number;
};

type ItemRow = {
  id: string;
  template_id: string;
  position: number;
  label: string;
  help_text: string | null;
  required: number;
};

type RunRow = {
  id: string;
  template_id: string;
  template_title: string;
  template_description: string | null;
  group_id: string;
  group_name: string;
  task_id: string | null;
  task_title: string | null;
  started_by: string;
  started_by_name: string;
  started_at: number;
  completed_at: number | null;
  completed_by: string | null;
  status: ChecklistRunStatus;
  outcome: ChecklistOutcome | null;
};

type RunItemRow = {
  id: string;
  position: number;
  label: string;
  help_text: string | null;
  required: number;
  result: ChecklistItemResult;
  note: string | null;
};

const RUN_COLUMNS = `r.id, r.template_id, r.template_title, r.template_description, r.group_id,
  g.name AS group_name, r.task_id, tk.title AS task_title, r.started_by,
  u.full_name AS started_by_name, r.started_at, r.completed_at, r.completed_by, r.status, r.outcome`;

export async function listTemplates(
  c: Context<AppEnv>,
  query: ChecklistListQuery,
): Promise<{ items: ChecklistTemplateSummary[] }> {
  const user = await requireUser(c);
  if (user.role !== 'admin' && user.groups.length === 0) {
    return { items: [] };
  }
  if (
    query.groupId &&
    user.role !== 'admin' &&
    !user.groups.some((group) => group.id === query.groupId)
  ) {
    return { items: [] };
  }
  if (user.role === 'volunteer' && query.status === 'inactive') {
    return { items: [] };
  }
  const where: string[] = [];
  const binds: string[] = [];
  if (user.role !== 'admin') {
    const ids = user.groups.map((group) => group.id);
    where.push(`t.group_id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  }
  if (query.groupId) {
    where.push('t.group_id = ?');
    binds.push(query.groupId);
  }
  if (user.role === 'volunteer') {
    where.push(`t.status = 'active'`);
  } else if (query.status) {
    where.push('t.status = ?');
    binds.push(query.status);
  }
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.group_id, g.name AS group_name, t.title, t.description, t.status,
            t.created_at, t.updated_at, COUNT(i.id) AS item_count
     FROM checklist_templates t
     JOIN groups g ON g.id = t.group_id
     LEFT JOIN checklist_template_items i ON i.template_id = t.id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY t.id
     ORDER BY t.title COLLATE NOCASE`,
  )
    .bind(...binds)
    .all<TemplateRow>();
  return { items: rows.results.map(toSummary) };
}

export async function createTemplate(
  c: Context<AppEnv>,
  input: CreateChecklistInput,
): Promise<ChecklistTemplate> {
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
    throw new ApiError(409, 'conflict', 'Il gruppo è archiviato.');
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const description = blankToNull(input.description);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO checklist_templates (
           id, group_id, title, description, status, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .bind(id, input.groupId, input.title, description, actor.id, now, now),
    ...itemInserts(db, id, input.items, now),
    auditStatement(db, {
      actorId: actor.id,
      action: 'checklist_template.saved',
      entityType: 'checklist_template',
      entityId: id,
      metadata: { status: 'active' },
      createdAt: now,
    }),
  ];
  await db.batch(statements);
  return readTemplate(db, actor, id);
}

export async function getTemplate(
  c: Context<AppEnv>,
  templateId: string,
): Promise<ChecklistTemplate> {
  const user = await requireUser(c);
  return readTemplate(c.env.DB, user, templateId);
}

export async function updateTemplate(
  c: Context<AppEnv>,
  templateId: string,
  input: PatchChecklistInput,
): Promise<ChecklistTemplate> {
  const actor = await requireUser(c);
  const current = await visibleTemplate(c.env.DB, actor, templateId);
  if (actor.role === 'volunteer') {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const db = c.env.DB;
  const now = Date.now();
  const description = blankToNull(input.description);
  await db.batch([
    db
      .prepare(
        `UPDATE checklist_templates
         SET title = ?, description = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.title, description, input.status, now, current.id),
    db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').bind(current.id),
    ...itemInserts(db, current.id, input.items, now),
    auditStatement(db, {
      actorId: actor.id,
      action: 'checklist_template.saved',
      entityType: 'checklist_template',
      entityId: current.id,
      metadata: { status: input.status },
      createdAt: now,
    }),
  ]);
  return readTemplate(db, actor, current.id);
}

export async function listRuns(c: Context<AppEnv>): Promise<{ items: ChecklistRunSummary[] }> {
  const user = await requireUser(c);
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
  if (user.role === 'volunteer') {
    where.push(
      `(r.started_by = ? OR r.task_id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))`,
    );
    binds.push(user.id, user.id);
  }
  const rows = await c.env.DB.prepare(
    `SELECT ${RUN_COLUMNS}
     FROM checklist_runs r
     JOIN groups g ON g.id = r.group_id
     JOIN users u ON u.id = r.started_by
     LEFT JOIN tasks tk ON tk.id = r.task_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.started_at DESC
     LIMIT 50`,
  )
    .bind(...binds)
    .all<RunRow>();
  return { items: rows.results.map(toRunSummary) };
}

export async function startRun(
  c: Context<AppEnv>,
  templateId: string,
  input: StartChecklistRunInput,
): Promise<ChecklistRun> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const template = await visibleTemplate(db, actor, templateId);
  if (template.status !== 'active') {
    throw new ApiError(409, 'conflict', INACTIVE);
  }
  const taskId = input.taskId ?? null;
  if (taskId) {
    const task = await db
      .prepare('SELECT id, group_id, title FROM tasks WHERE id = ?')
      .bind(taskId)
      .first<{ id: string; group_id: string; title: string }>();
    if (!task || !seesGroup(actor, task.group_id)) {
      throw new ApiError(404, 'not_found', NOT_FOUND);
    }
    if (task.group_id !== template.group_id) {
      throw new ApiError(400, 'validation_error', SAME_GROUP);
    }
    const open = await db
      .prepare(
        `SELECT id FROM checklist_runs
         WHERE task_id = ? AND template_id = ? AND status = 'in_progress'`,
      )
      .bind(task.id, template.id)
      .first();
    if (open) {
      throw new ApiError(409, 'conflict', OPEN_RUN);
    }
  }
  const items = await templateItems(db, template.id);
  const now = Date.now();
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO checklist_runs (
           id, template_id, template_title, template_description, group_id, task_id,
           started_by, started_at, completed_at, completed_by, status, outcome, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'in_progress', NULL, NULL)`,
      )
      .bind(
        id,
        template.id,
        template.title,
        template.description,
        template.group_id,
        taskId,
        actor.id,
        now,
      ),
  ];
  for (const item of items) {
    statements.push(
      db
        .prepare(
          `INSERT INTO checklist_run_items (
             id, run_id, source_item_id, position, label, help_text, required, result, note, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          item.id,
          item.position,
          item.label,
          item.help_text,
          item.required,
          now,
        ),
    );
  }
  statements.push(
    auditStatement(db, {
      actorId: actor.id,
      action: 'checklist_run.started',
      entityType: 'checklist_run',
      entityId: id,
      metadata: { templateId: template.id },
      createdAt: now,
    }),
  );
  await db.batch(statements);
  return readRun(db, actor, id);
}

export async function getRun(c: Context<AppEnv>, runId: string): Promise<ChecklistRun> {
  const user = await requireUser(c);
  return readRun(c.env.DB, user, runId);
}

export async function updateRunItem(
  c: Context<AppEnv>,
  runId: string,
  itemId: string,
  input: PatchChecklistItemInput,
): Promise<ChecklistRun> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const run = await visibleRun(db, actor, runId);
  if (run.status !== 'in_progress') {
    throw new ApiError(409, 'conflict', CONFLICT);
  }
  if (!canEdit(actor, run)) {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const item = await db
    .prepare('SELECT id, required FROM checklist_run_items WHERE id = ? AND run_id = ?')
    .bind(itemId, run.id)
    .first<{ id: string; required: number }>();
  if (!item) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (input.result === 'not_applicable' && item.required === 1) {
    throw new ApiError(400, 'validation_error', CLOSE_RULE);
  }
  const now = Date.now();
  await db
    .prepare(
      `UPDATE checklist_run_items
       SET result = ?, note = ?, updated_at = ?
       WHERE id = ? AND run_id = ?`,
    )
    .bind(input.result, blankToNull(input.note), now, item.id, run.id)
    .run();
  return readRun(db, actor, run.id);
}

export async function completeRun(c: Context<AppEnv>, runId: string): Promise<ChecklistRun> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const run = await visibleRun(db, actor, runId);
  if (run.status !== 'in_progress') {
    throw new ApiError(409, 'conflict', CONFLICT);
  }
  if (!canEdit(actor, run)) {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const items = await runItems(db, run.id);
  const outcome = outcomeOf(items);
  if (!outcome) {
    throw new ApiError(409, 'conflict', CLOSE_RULE);
  }
  const coordinators = await coordinatorIds(db, run.group_id, actor.id);
  const subscriptions = await loadSubscriptionMap(db, coordinators);
  const now = Date.now();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE checklist_runs
         SET status = 'completed', outcome = ?, completed_at = ?, completed_by = ?
         WHERE id = ? AND status = 'in_progress'`,
      )
      .bind(outcome, now, actor.id, run.id),
    db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at)
         SELECT ?, ?, 'checklist_run.completed', 'checklist_run', ?, ?, ?
         WHERE changes() > 0`,
      )
      .bind(crypto.randomUUID(), actor.id, run.id, JSON.stringify({ outcome }), now),
    ...noticeStatements(
      db,
      coordinators.map((userId) => checklistNotice(userId, run.template_title, run.id)),
      subscriptions,
      now,
      { kind: 'changes' },
    ),
  ]);
  if (changed(results[0]) === 0) {
    throw new ApiError(409, 'conflict', CONFLICT);
  }
  return readRun(db, actor, run.id);
}

export async function cancelRun(c: Context<AppEnv>, runId: string): Promise<ChecklistRun> {
  const actor = await requireUser(c);
  const db = c.env.DB;
  const run = await visibleRun(db, actor, runId);
  if (run.status !== 'in_progress') {
    throw new ApiError(409, 'conflict', CONFLICT);
  }
  if (!canEdit(actor, run)) {
    throw new ApiError(403, 'forbidden', FORBIDDEN);
  }
  const now = Date.now();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE checklist_runs
         SET status = 'cancelled'
         WHERE id = ? AND status = 'in_progress'`,
      )
      .bind(run.id),
    db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at)
         SELECT ?, ?, 'checklist_run.cancelled', 'checklist_run', ?, NULL, ?
         WHERE changes() > 0`,
      )
      .bind(crypto.randomUUID(), actor.id, run.id, now),
  ]);
  if (changed(results[0]) === 0) {
    throw new ApiError(409, 'conflict', CONFLICT);
  }
  return readRun(db, actor, run.id);
}

export async function assertActiveTemplates(
  db: D1Database,
  groupId: string,
  templateIds: readonly string[],
  taskId: string | null = null,
): Promise<void> {
  if (templateIds.length === 0) {
    return;
  }
  const found = await db
    .prepare(
      `SELECT id
       FROM checklist_templates
       WHERE group_id = ?
         AND id IN (${placeholders(templateIds.length)})
         AND (
           status = 'active'
           OR (? IS NOT NULL AND id IN (SELECT template_id FROM task_checklists WHERE task_id = ?))
         )`,
    )
    .bind(groupId, ...templateIds, taskId, taskId)
    .all<{ id: string }>();
  if (found.results.length !== templateIds.length) {
    throw new ApiError(
      400,
      'validation_error',
      'Le checklist devono essere modelli attivi dello stesso gruppo.',
    );
  }
}

export function checklistLinkInsert(
  db: D1Database,
  taskId: string,
  templateId: string,
  position: number,
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO task_checklists (task_id, template_id, position) VALUES (?, ?, ?)')
    .bind(taskId, templateId, position);
}

function seesGroup(user: CurrentUser, groupId: string): boolean {
  return user.role === 'admin' || user.groups.some((group) => group.id === groupId);
}

function canEdit(user: CurrentUser, run: RunRow): boolean {
  if (user.role !== 'volunteer') {
    return seesGroup(user, run.group_id);
  }
  return run.started_by === user.id;
}

async function visibleTemplate(
  db: D1Database,
  user: CurrentUser,
  templateId: string,
): Promise<TemplateRow> {
  const row = await db
    .prepare(
      `SELECT t.id, t.group_id, g.name AS group_name, t.title, t.description, t.status,
              t.created_at, t.updated_at, COUNT(i.id) AS item_count
       FROM checklist_templates t
       JOIN groups g ON g.id = t.group_id
       LEFT JOIN checklist_template_items i ON i.template_id = t.id
       WHERE t.id = ?
       GROUP BY t.id`,
    )
    .bind(templateId)
    .first<TemplateRow>();
  if (!row || !seesGroup(user, row.group_id)) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (user.role === 'volunteer' && row.status !== 'active') {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return row;
}

async function readTemplate(
  db: D1Database,
  user: CurrentUser,
  templateId: string,
): Promise<ChecklistTemplate> {
  const row = await visibleTemplate(db, user, templateId);
  const items = await templateItems(db, row.id);
  return {
    ...toSummary(row),
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      label: item.label,
      helpText: item.help_text,
      required: item.required === 1,
    })),
  };
}

async function templateItems(db: D1Database, templateId: string): Promise<ItemRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, template_id, position, label, help_text, required
       FROM checklist_template_items
       WHERE template_id = ?
       ORDER BY position ASC`,
    )
    .bind(templateId)
    .all<ItemRow>();
  return rows.results;
}

async function visibleRun(db: D1Database, user: CurrentUser, runId: string): Promise<RunRow> {
  const row = await db
    .prepare(
      `SELECT ${RUN_COLUMNS}
       FROM checklist_runs r
       JOIN groups g ON g.id = r.group_id
       JOIN users u ON u.id = r.started_by
       LEFT JOIN tasks tk ON tk.id = r.task_id
       WHERE r.id = ?`,
    )
    .bind(runId)
    .first<RunRow>();
  if (!row || !seesGroup(user, row.group_id)) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  if (user.role === 'volunteer' && !(await volunteerCanSeeRun(db, user.id, row))) {
    throw new ApiError(404, 'not_found', NOT_FOUND);
  }
  return row;
}

async function volunteerCanSeeRun(db: D1Database, userId: string, run: RunRow): Promise<boolean> {
  if (run.started_by === userId) {
    return true;
  }
  if (!run.task_id) {
    return false;
  }
  const assigned = await db
    .prepare('SELECT 1 AS ok FROM task_assignees WHERE task_id = ? AND user_id = ?')
    .bind(run.task_id, userId)
    .first();
  return assigned !== null;
}

async function readRun(db: D1Database, user: CurrentUser, runId: string): Promise<ChecklistRun> {
  const row = await visibleRun(db, user, runId);
  const items = await runItems(db, row.id);
  return {
    ...toRunSummary(row),
    description: row.template_description,
    startedBy: row.started_by,
    startedByName: row.started_by_name,
    completedAt: iso(row.completed_at),
    completedBy: row.completed_by,
    items: items.map(toRunItem),
  };
}

async function runItems(db: D1Database, runId: string): Promise<RunItemRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, position, label, help_text, required, result, note
       FROM checklist_run_items
       WHERE run_id = ?
       ORDER BY position ASC`,
    )
    .bind(runId)
    .all<RunItemRow>();
  return rows.results;
}

function outcomeOf(items: readonly RunItemRow[]): ChecklistOutcome | null {
  for (const item of items) {
    if (item.required === 1 && item.result !== 'compliant' && item.result !== 'non_compliant') {
      return null;
    }
    if (item.required === 0 && item.result === 'not_applicable') {
      continue;
    }
  }
  return items.some((item) => item.result === 'non_compliant') ? 'non_compliant' : 'compliant';
}

function itemInserts(
  db: D1Database,
  templateId: string,
  items: CreateChecklistInput['items'],
  now: number,
): D1PreparedStatement[] {
  void now;
  return items.map((item, position) =>
    db
      .prepare(
        `INSERT INTO checklist_template_items (id, template_id, position, label, help_text, required)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        templateId,
        position,
        item.label,
        blankToNull(item.helpText),
        item.required ? 1 : 0,
      ),
  );
}

function toSummary(row: TemplateRow): ChecklistTemplateSummary {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    title: row.title,
    description: row.description,
    status: row.status,
    itemCount: Number(row.item_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toRunSummary(row: RunRow): ChecklistRunSummary {
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.template_title,
    groupId: row.group_id,
    groupName: row.group_name,
    taskId: row.task_id,
    taskTitle: row.task_title,
    status: row.status,
    outcome: row.outcome,
    startedAt: new Date(row.started_at).toISOString(),
  };
}

function toRunItem(row: RunItemRow): ChecklistRunItem {
  return {
    id: row.id,
    position: row.position,
    label: row.label,
    helpText: row.help_text,
    required: row.required === 1,
    result: row.result,
    note: row.note,
  };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
