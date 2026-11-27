import type { UserStatus } from './account';
import type { TaskChecklist } from './checklists';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'cancelled';

export type TaskAssignee = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
};

export type TaskRecurrence = {
  ruleId: string;
  occurrenceLocalDate: string;
  detached: boolean;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  groupId: string;
  groupName: string;
  createdBy: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  recurrence: TaskRecurrence | null;
  assignees: TaskAssignee[];
  checklists: TaskChecklist[];
  createdAt: string;
  updatedAt: string;
};

export type TaskList = {
  items: TaskRecord[];
  page: number;
  pageSize: number;
  total: number;
};

export type TaskHistoryItem = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  createdAt: string;
  metadata: Record<string, string> | null;
};

export type DashboardNotification = {
  id: string;
  title: string;
  body: string;
  path: string;
  createdAt: string;
};

export type DashboardAssignment = {
  userId: string;
  fullName: string;
  openTasks: number;
};

export type DashboardGroup = {
  open: number;
  overdue: number;
  completedLast30Days: number;
  checklistsInProgress: number;
  assignments: DashboardAssignment[];
};

export type Dashboard = {
  personal: {
    assignedOpen: number;
    claimable: number;
    urgentOpen: number;
    overdue: number;
    dueSoon: number;
    openChecklists: number;
  };
  notifications: DashboardNotification[];
  group: DashboardGroup | null;
};
