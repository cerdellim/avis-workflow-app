-- Schema iniziale dell'MVP.
-- Tutti gli istanti sono millisecondi Unix UTC.
-- Le date di calendario (starts_on, occurrence_local_date) sono date locali Europe/Rome, formato YYYY-MM-DD.
-- L'applicazione non cancella fisicamente utenti, gruppi, attività o checklist storiche.
-- Le chiavi esterne sono attive di default su D1: la Fase 1 deve verificarlo con un inserimento orfano.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'coordinator', 'volunteer')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
  password_changed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER,
  CHECK (status != 'active' OR password_hash IS NOT NULL),
  CHECK (status != 'disabled' OR disabled_at IS NOT NULL)
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members (user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT,
  ip_hash TEXT
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE invitation_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'password_reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_invitation_tokens_user ON invitation_tokens (user_id, purpose, created_at);

CREATE TABLE recurrence_rules (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 365),
  weekdays TEXT,
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year INTEGER CHECK (month_of_year BETWEEN 1 AND 12),
  local_time TEXT NOT NULL CHECK (length(local_time) = 5),
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome' CHECK (timezone = 'Europe/Rome'),
  starts_on TEXT NOT NULL CHECK (length(starts_on) = 10),
  ends_on TEXT CHECK (ends_on IS NULL OR length(ends_on) = 10),
  suspended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (frequency != 'weekly' OR weekdays IS NOT NULL),
  CHECK (frequency != 'monthly' OR day_of_month IS NOT NULL),
  CHECK (frequency != 'yearly' OR (day_of_month IS NOT NULL AND month_of_year IS NOT NULL)),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX idx_recurrence_rules_group ON recurrence_rules (group_id, suspended_at);

CREATE TABLE recurrence_assignees (
  rule_id TEXT NOT NULL REFERENCES recurrence_rules (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  PRIMARY KEY (rule_id, user_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'completed', 'cancelled')),
  due_at INTEGER,
  completed_at INTEGER,
  completed_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  cancelled_at INTEGER,
  cancelled_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  claimed_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  claimed_at INTEGER,
  recurrence_rule_id TEXT REFERENCES recurrence_rules (id) ON DELETE SET NULL,
  occurrence_local_date TEXT CHECK (occurrence_local_date IS NULL OR length(occurrence_local_date) = 10),
  recurrence_detached INTEGER NOT NULL DEFAULT 0 CHECK (recurrence_detached IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR (status != 'completed' AND completed_at IS NULL AND completed_by IS NULL)
  ),
  CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
    OR (status != 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL)
  ),
  CHECK (
    (recurrence_rule_id IS NULL AND occurrence_local_date IS NULL)
    OR (recurrence_rule_id IS NOT NULL AND occurrence_local_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_tasks_occurrence
  ON tasks (recurrence_rule_id, occurrence_local_date)
  WHERE recurrence_rule_id IS NOT NULL;

CREATE INDEX idx_tasks_group_status_due ON tasks (group_id, status, due_at);
CREATE INDEX idx_tasks_open_due ON tasks (due_at) WHERE status IN ('todo', 'in_progress');
CREATE INDEX idx_tasks_created_by ON tasks (created_by);

CREATE TABLE task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assigned_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_task_assignees_user ON task_assignees (user_id);

CREATE TABLE checklist_templates (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_checklist_templates_group ON checklist_templates (group_id, status);

CREATE TABLE checklist_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES checklist_templates (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL,
  help_text TEXT,
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  UNIQUE (template_id, position)
);

CREATE TABLE checklist_runs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES checklist_templates (id) ON DELETE RESTRICT,
  template_title TEXT NOT NULL,
  template_description TEXT,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  started_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  completed_by TEXT REFERENCES users (id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('compliant', 'non_compliant')),
  notes TEXT,
  CHECK (
    (
      status = 'completed'
      AND completed_at IS NOT NULL
      AND completed_by IS NOT NULL
      AND outcome IS NOT NULL
    )
    OR (
      status IN ('in_progress', 'cancelled')
      AND completed_at IS NULL
      AND completed_by IS NULL
      AND outcome IS NULL
    )
  )
);

CREATE INDEX idx_checklist_runs_group ON checklist_runs (group_id, status, started_at);
CREATE INDEX idx_checklist_runs_template ON checklist_runs (template_id);
CREATE INDEX idx_checklist_runs_starter ON checklist_runs (started_by, started_at);
CREATE INDEX idx_checklist_runs_task ON checklist_runs (task_id);

CREATE TABLE checklist_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES checklist_runs (id) ON DELETE CASCADE,
  source_item_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL,
  help_text TEXT,
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  result TEXT NOT NULL CHECK (result IN ('pending', 'compliant', 'non_compliant', 'not_applicable')),
  note TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (run_id, position)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'task_assigned',
      'task_due_soon',
      'task_overdue',
      'task_completed',
      'checklist_completed'
    )
  ),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('task', 'checklist_run')),
  resource_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, type, resource_id, dedup_key)
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read_at, created_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_success_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE push_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'abandoned')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_status_code INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (notification_id, subscription_id)
);

CREATE INDEX idx_push_deliveries_due ON push_deliveries (status, next_attempt_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id, created_at);
CREATE INDEX idx_audit_created ON audit_logs (created_at);

CREATE TABLE auth_attempts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('login', 'setup', 'invite', 'password_reset')),
  subject_hash TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1))
);

CREATE INDEX idx_auth_attempts_lookup ON auth_attempts (scope, subject_hash, attempted_at);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value, updated_at, updated_by)
VALUES
  ('association_name', 'Volontari', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('due_soon_hours', '24', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('session_idle_hours', '12', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('session_absolute_days', '14', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('invite_ttl_hours', '168', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('reset_ttl_hours', '24', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('login_max_failures', '5', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL),
  ('login_window_minutes', '15', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL);
