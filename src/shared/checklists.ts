export type ChecklistTemplateStatus = 'active' | 'inactive';
export type ChecklistItemResult = 'pending' | 'compliant' | 'non_compliant' | 'not_applicable';
export type ChecklistRunStatus = 'in_progress' | 'completed' | 'cancelled';
export type ChecklistOutcome = 'compliant' | 'non_compliant';

export type ChecklistItem = {
  id: string;
  position: number;
  label: string;
  helpText: string | null;
  required: boolean;
};

export type ChecklistTemplateSummary = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string | null;
  status: ChecklistTemplateStatus;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistTemplate = ChecklistTemplateSummary & {
  items: ChecklistItem[];
};

export type ChecklistRunItem = ChecklistItem & {
  result: ChecklistItemResult;
  note: string | null;
};

export type ChecklistRunSummary = {
  id: string;
  templateId: string;
  title: string;
  groupId: string;
  groupName: string;
  taskId: string | null;
  taskTitle: string | null;
  status: ChecklistRunStatus;
  outcome: ChecklistOutcome | null;
  startedAt: string;
};

export type ChecklistRun = ChecklistRunSummary & {
  description: string | null;
  startedBy: string;
  startedByName: string;
  completedAt: string | null;
  completedBy: string | null;
  items: ChecklistRunItem[];
};

export type TaskChecklistRun = {
  id: string;
  status: ChecklistRunStatus;
  outcome: ChecklistOutcome | null;
};

export type TaskChecklist = {
  templateId: string;
  title: string;
  status: ChecklistTemplateStatus;
  run: TaskChecklistRun | null;
};
