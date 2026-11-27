export type NotificationType =
  'task_assigned' | 'task_due_soon' | 'task_overdue' | 'task_completed' | 'checklist_completed';

export type NotificationResource = 'task' | 'checklist_run';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType: NotificationResource;
  resourceId: string;
  path: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationList = {
  unread: number;
  items: NotificationItem[];
};

export function resourcePath(resourceType: NotificationResource, resourceId: string): string {
  if (resourceType === 'checklist_run') {
    return `/checklist/esecuzioni/${resourceId}`;
  }
  return `/attivita/${resourceId}`;
}
