export type AuditEntry = {
  id: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

export type SettingsRecord = {
  associationName: string;
  dueSoonHours: number;
};
