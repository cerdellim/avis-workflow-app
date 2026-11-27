import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackupDocument } from '../src/shared/backup-format.ts';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.restore-proof');
const now = Date.parse('2026-11-24T09:00:00.000Z');
const userId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';

const settings = [
  ['association_name', 'Ripristino'],
  ['due_soon_hours', '24'],
  ['session_idle_hours', '12'],
  ['session_absolute_days', '14'],
  ['invite_ttl_hours', '168'],
  ['reset_ttl_hours', '24'],
  ['login_max_failures', '5'],
  ['login_window_minutes', '15'],
];

const document: BackupDocument = {
  version: 1,
  exportedAt: '2026-11-24T09:00:00.000Z',
  tables: {
    users: [
      {
        id: userId,
        email: 'ripristino@example.org',
        full_name: 'Ada Ripristino',
        password_hash: 'hash-di-prova',
        role: 'admin',
        status: 'active',
        password_changed_at: now,
        created_at: now,
        updated_at: now,
        disabled_at: null,
      },
    ],
    groups: [
      {
        id: groupId,
        name: 'Squadra Ripristino',
        description: null,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ],
    group_members: [{ group_id: groupId, user_id: userId, created_at: now, created_by: userId }],
    recurrence_rules: [],
    recurrence_assignees: [],
    tasks: [
      {
        id: taskId,
        title: 'Attività ripristinata',
        description: null,
        group_id: groupId,
        created_by: userId,
        priority: 'normal',
        status: 'todo',
        due_at: null,
        completed_at: null,
        completed_by: null,
        cancelled_at: null,
        cancelled_by: null,
        claimed_by: null,
        claimed_at: null,
        recurrence_rule_id: null,
        occurrence_local_date: null,
        recurrence_detached: 0,
        created_at: now,
        updated_at: now,
      },
    ],
    task_assignees: [],
    checklist_templates: [],
    checklist_template_items: [],
    task_checklists: [],
    checklist_runs: [],
    checklist_run_items: [],
    notifications: [],
    push_subscriptions: [],
    app_settings: settings.map(([key, value]) => ({
      key: key ?? '',
      value: value ?? '',
      updated_at: now,
      updated_by: userId,
    })),
    audit_logs: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        actor_id: userId,
        action: 'export.backup',
        entity_type: 'backup',
        entity_id: null,
        metadata: null,
        created_at: now,
      },
    ],
  },
};

mkdirSync(dir, { recursive: true });
const jsonPath = path.join(dir, 'copia.json');
writeFileSync(jsonPath, JSON.stringify(document));
const result = spawnSync(process.execPath, ['scripts/restore-local.ts', jsonPath, dir], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, CI: '1' },
});
if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}
const line = result.stdout.trim().split('\n').at(-1);
const row = JSON.parse(line ?? '{}') as {
  users: number;
  groups: number;
  members: number;
  tasks: number;
  sessions: number;
  settings: number;
  email: string;
  title: string;
};
const expected = {
  users: 1,
  groups: 1,
  members: 1,
  tasks: 1,
  sessions: 0,
  settings: 8,
  email: 'ripristino@example.org',
  title: 'Attività ripristinata',
};
for (const [key, value] of Object.entries(expected)) {
  if (row[key as keyof typeof expected] !== value) {
    console.error(JSON.stringify(row));
    throw new Error(`${key}: atteso ${String(value)}`);
  }
}
console.log('ripristino locale verificato');
