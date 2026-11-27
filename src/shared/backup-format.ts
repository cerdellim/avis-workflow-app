export type BackupCell = string | number | null;

export type BackupDocument = {
  version: 1;
  exportedAt: string;
  tables: Record<string, Record<string, BackupCell>[]>;
};

type TableSpec = {
  name: string;
  columns: readonly string[];
};

export const BACKUP_TABLES: readonly TableSpec[] = [
  {
    name: 'users',
    columns: [
      'id',
      'email',
      'full_name',
      'password_hash',
      'role',
      'status',
      'password_changed_at',
      'created_at',
      'updated_at',
      'disabled_at',
    ],
  },
  {
    name: 'groups',
    columns: ['id', 'name', 'description', 'status', 'created_at', 'updated_at'],
  },
  {
    name: 'group_members',
    columns: ['group_id', 'user_id', 'created_at', 'created_by'],
  },
  {
    name: 'recurrence_rules',
    columns: [
      'id',
      'group_id',
      'created_by',
      'title',
      'description',
      'priority',
      'frequency',
      'interval_count',
      'weekdays',
      'day_of_month',
      'month_of_year',
      'local_time',
      'timezone',
      'starts_on',
      'ends_on',
      'suspended_at',
      'created_at',
      'updated_at',
    ],
  },
  { name: 'recurrence_assignees', columns: ['rule_id', 'user_id'] },
  {
    name: 'tasks',
    columns: [
      'id',
      'title',
      'description',
      'group_id',
      'created_by',
      'priority',
      'status',
      'due_at',
      'completed_at',
      'completed_by',
      'cancelled_at',
      'cancelled_by',
      'claimed_by',
      'claimed_at',
      'recurrence_rule_id',
      'occurrence_local_date',
      'recurrence_detached',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'task_assignees',
    columns: ['task_id', 'user_id', 'assigned_by', 'assigned_at'],
  },
  {
    name: 'checklist_templates',
    columns: [
      'id',
      'group_id',
      'title',
      'description',
      'status',
      'created_by',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'checklist_template_items',
    columns: ['id', 'template_id', 'position', 'label', 'help_text', 'required'],
  },
  { name: 'task_checklists', columns: ['task_id', 'template_id', 'position'] },
  {
    name: 'checklist_runs',
    columns: [
      'id',
      'template_id',
      'template_title',
      'template_description',
      'group_id',
      'task_id',
      'started_by',
      'started_at',
      'completed_at',
      'completed_by',
      'status',
      'outcome',
      'notes',
    ],
  },
  {
    name: 'checklist_run_items',
    columns: [
      'id',
      'run_id',
      'source_item_id',
      'position',
      'label',
      'help_text',
      'required',
      'result',
      'note',
      'updated_at',
    ],
  },
  {
    name: 'notifications',
    columns: [
      'id',
      'user_id',
      'type',
      'title',
      'body',
      'resource_type',
      'resource_id',
      'dedup_key',
      'read_at',
      'created_at',
    ],
  },
  {
    name: 'push_subscriptions',
    columns: [
      'id',
      'user_id',
      'endpoint',
      'p256dh',
      'auth_key',
      'user_agent',
      'created_at',
      'last_success_at',
      'failure_count',
    ],
  },
  { name: 'app_settings', columns: ['key', 'value', 'updated_at', 'updated_by'] },
  {
    name: 'audit_logs',
    columns: ['id', 'actor_id', 'action', 'entity_type', 'entity_id', 'metadata', 'created_at'],
  },
];

// Le attività si cancellano prima delle ricorrenze: ON DELETE SET NULL violerebbe il vincolo
// che lega recurrence_rule_id e occurrence_local_date.
const WIPE_TABLES = [
  'push_deliveries',
  'push_subscriptions',
  'notifications',
  'checklist_run_items',
  'checklist_runs',
  'task_checklists',
  'checklist_template_items',
  'checklist_templates',
  'task_assignees',
  'tasks',
  'recurrence_assignees',
  'recurrence_rules',
  'audit_logs',
  'group_members',
  'invitation_tokens',
  'sessions',
  'auth_attempts',
  'groups',
  'users',
  'app_settings',
] as const;

export function backupStatements(document: BackupDocument): string[] {
  if (document.version !== 1) {
    throw new Error('Copia non valida.');
  }
  const names = BACKUP_TABLES.map((table) => table.name);
  const received = Object.keys(document.tables);
  if (received.length !== names.length || names.some((name) => !received.includes(name))) {
    throw new Error('Copia non valida.');
  }
  const statements = WIPE_TABLES.map((table) => `DELETE FROM ${table}`);
  for (const table of BACKUP_TABLES) {
    const rows = document.tables[table.name];
    if (!Array.isArray(rows)) {
      throw new Error('Copia non valida.');
    }
    for (const row of rows) {
      statements.push(insertStatement(table, row));
    }
  }
  return statements;
}

export function backupScript(document: BackupDocument): string {
  return `${backupStatements(document).join(';\n')};\n`;
}

function insertStatement(table: TableSpec, row: Record<string, BackupCell>): string {
  const keys = Object.keys(row);
  if (
    keys.length !== table.columns.length ||
    table.columns.some((column) => !Object.hasOwn(row, column))
  ) {
    throw new Error('Copia non valida.');
  }
  const values = table.columns.map((column) => sqlValue(row[column]));
  return `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${values.join(', ')})`;
}

function sqlValue(value: BackupCell | undefined): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Copia non valida.');
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new Error('Copia non valida.');
}
