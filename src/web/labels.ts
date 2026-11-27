import type { GroupStatus, Role, UserStatus } from '../shared/account';
import type {
  ChecklistItemResult,
  ChecklistOutcome,
  ChecklistRunStatus,
  ChecklistTemplateStatus,
} from '../shared/checklists';
import type { TaskPriority, TaskStatus } from '../shared/tasks';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Amministratore',
  coordinator: 'Coordinatore',
  volunteer: 'Volontario',
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  invited: 'Invitato',
  active: 'Attivo',
  disabled: 'Disattivato',
};

export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  active: 'Attivo',
  archived: 'Archiviato',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Da fare',
  in_progress: 'In corso',
  completed: 'Completata',
  cancelled: 'Annullata',
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Bassa',
  normal: 'Normale',
  high: 'Alta',
  urgent: 'Urgente',
};

export const CHECKLIST_STATUS_LABEL: Record<ChecklistTemplateStatus, string> = {
  active: 'Attiva',
  inactive: 'Inattiva',
};

export const CHECKLIST_RESULT_LABEL: Record<ChecklistItemResult, string> = {
  pending: 'Da verificare',
  compliant: 'Conforme',
  non_compliant: 'Non conforme',
  not_applicable: 'Non applicabile',
};

export const CHECKLIST_RUN_LABEL: Record<ChecklistRunStatus, string> = {
  in_progress: 'In corso',
  completed: 'Completata',
  cancelled: 'Annullata',
};

export const CHECKLIST_OUTCOME_LABEL: Record<ChecklistOutcome, string> = {
  compliant: 'Conforme',
  non_compliant: 'Non conforme',
};

export const TASK_ACTION_LABEL: Record<string, string> = {
  'task.created': 'Creata',
  'task.updated': 'Modificata',
  'task.claimed': 'Presa in carico',
  'task.released': 'Rilasciata',
  'task.completed': 'Completata',
  'task.reopened': 'Riaperta',
  'task.cancelled': 'Annullata',
};
