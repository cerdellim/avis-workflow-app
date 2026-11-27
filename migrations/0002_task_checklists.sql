CREATE TABLE task_checklists (
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES checklist_templates (id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (task_id, template_id),
  UNIQUE (task_id, position)
);

CREATE INDEX idx_task_checklists_template ON task_checklists (template_id);
