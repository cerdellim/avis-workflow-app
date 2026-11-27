type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, string>;
  createdAt: number;
};

export function auditStatement(db: D1Database, input: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.actorId,
      input.action,
      input.entityType,
      input.entityId,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdAt,
    );
}
