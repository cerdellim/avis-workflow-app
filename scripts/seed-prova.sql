-- Dati di prova locali per Avis Berceto.
-- Non è una migrazione: non entra nei test. Si applica solo al D1 locale.

UPDATE app_settings
SET value = 'Avis Berceto',
    updated_at = 1795510800000
WHERE key = 'association_name';

UPDATE recurrence_rules
SET suspended_at = 1795510800000,
    updated_at = 1795510800000
WHERE id = '4f450f81-822e-4552-a4d2-b02f05ad69a8'
  AND suspended_at IS NULL;

UPDATE tasks
SET status = 'cancelled',
    cancelled_at = 1795510800000,
    cancelled_by = '9d7de538-4ceb-4f96-b28c-439701e79407',
    updated_at = 1795510800000
WHERE status IN ('todo', 'in_progress')
  AND id != '7a1b2c3d-8e5f-4a67-8b89-0c1d2e3f4a5b';

UPDATE checklist_runs
SET status = 'cancelled'
WHERE status = 'in_progress'
  AND (task_id IS NULL OR task_id != '7a1b2c3d-8e5f-4a67-8b89-0c1d2e3f4a5b');

UPDATE checklist_templates
SET status = 'inactive',
    updated_at = 1795510800000
WHERE id != '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f';

INSERT OR IGNORE INTO checklist_templates (
  id, group_id, title, description, status, created_by, created_at, updated_at
) VALUES (
  '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f',
  '31824e83-96cb-410a-b5f1-d53902e0afe1',
  'Preparazione sede',
  'Controlli da fare prima della giornata di raccolta.',
  'active',
  'dd138955-cca7-4884-8df6-2c122f8bf297',
  1795510800000,
  1795510800000
);

INSERT OR IGNORE INTO checklist_template_items (id, template_id, position, label, help_text, required) VALUES
  ('11111111-1111-4111-8111-111111111101', '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f', 0, 'Sala prelievi allestita', 'Lettino, carrello e privacy.', 1),
  ('11111111-1111-4111-8111-111111111102', '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f', 1, 'Acqua per i donatori', 'Bottiglie e bicchieri nel punto di ristoro.', 1),
  ('11111111-1111-4111-8111-111111111103', '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f', 2, 'Pulizia della sede', 'Pavimenti, bagni e superfici di lavoro.', 1),
  ('11111111-1111-4111-8111-111111111104', '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f', 3, 'Materiale di prelievo controllato', 'Sacche, provette, disinfettante e guanti.', 1),
  ('11111111-1111-4111-8111-111111111105', '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f', 4, 'Lettini e sedie pronti', 'Posti per il prelievo e per il riposo.', 1),
  ('11111111-1111-4111-8111-111111111106', '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f', 5, 'Modulistica e registro', 'Questionari e registro della giornata.', 1);

INSERT OR IGNORE INTO tasks (
  id, title, description, group_id, created_by, priority, status, due_at,
  completed_at, completed_by, cancelled_at, cancelled_by, claimed_by, claimed_at,
  recurrence_rule_id, occurrence_local_date, recurrence_detached, created_at, updated_at
) VALUES (
  '7a1b2c3d-8e5f-4a67-8b89-0c1d2e3f4a5b',
  'Donazione sangue',
  'Giornata di raccolta in sede. Prima di chiuderla completa la preparazione della sede.',
  '31824e83-96cb-410a-b5f1-d53902e0afe1',
  'dd138955-cca7-4884-8df6-2c122f8bf297',
  'high',
  'todo',
  1795851000000,
  NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, 0,
  1795510800000,
  1795510800000
);

INSERT OR IGNORE INTO task_assignees (task_id, user_id, assigned_by, assigned_at) VALUES (
  '7a1b2c3d-8e5f-4a67-8b89-0c1d2e3f4a5b',
  'c4823a0b-a92e-4d2d-924c-117458720134',
  'dd138955-cca7-4884-8df6-2c122f8bf297',
  1795510800000
);

INSERT OR IGNORE INTO task_checklists (task_id, template_id, position) VALUES (
  '7a1b2c3d-8e5f-4a67-8b89-0c1d2e3f4a5b',
  '6f0a1c2e-7b34-4d55-8e16-0a1b2c3d4e5f',
  0
);

INSERT OR IGNORE INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at) VALUES (
  '22222222-2222-4222-8222-222222222201',
  'dd138955-cca7-4884-8df6-2c122f8bf297',
  'task.created',
  'task',
  '7a1b2c3d-8e5f-4a67-8b89-0c1d2e3f4a5b',
  NULL,
  1795510800000
);
