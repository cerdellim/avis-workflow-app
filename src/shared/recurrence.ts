import type { TaskPriority, TaskStatus } from './tasks';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceAssignee = {
  id: string;
  fullName: string;
};

export type RecurrenceRule = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  weekdays: number[] | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  localTime: string;
  startsOn: string;
  endsOn: string | null;
  suspendedAt: string | null;
  assignees: RecurrenceAssignee[];
  createdAt: string;
  updatedAt: string;
};

export type CalendarItem = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string;
  localDate: string;
  groupName: string;
  occurrenceLocalDate: string | null;
};

export type CalendarResponse = {
  from: string;
  to: string;
  items: CalendarItem[];
};
