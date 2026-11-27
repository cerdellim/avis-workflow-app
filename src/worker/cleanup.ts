export async function cleanupAuthRecords(db: D1Database, now: number): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  await db.batch([
    db.prepare('DELETE FROM auth_attempts WHERE attempted_at < ?').bind(now - 2 * day),
    db
      .prepare(
        'DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
      )
      .bind(now - 30 * day, now - 30 * day),
    db.prepare('DELETE FROM invitation_tokens WHERE expires_at < ?').bind(now - 90 * day),
    db.prepare('DELETE FROM notifications WHERE created_at < ?').bind(now - 180 * day),
    db
      .prepare(
        `DELETE FROM push_deliveries
         WHERE status IN ('sent', 'abandoned') AND updated_at < ?`,
      )
      .bind(now - 30 * day),
  ]);
}
