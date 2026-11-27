import { auditStatement } from './audit';
import { cleanupAuthRecords } from './cleanup';
import { createDeadlineNotices, drainPush, vapidOptions, type TickOptions } from './notifications';
import { generateOccurrences } from './recurrences';
import { loadSettings } from './settings';

export { vapidOptions };
export type { TickOptions };

export async function runTick(
  db: D1Database,
  now: number,
  actorId: string | null,
  options?: TickOptions,
): Promise<{ inserted: number }> {
  const inserted = await generateOccurrences(db, now);
  const settings = await loadSettings(db);
  await createDeadlineNotices(db, now, settings.dueSoonMs);
  await drainPush(db, now, options);
  await cleanupAuthRecords(db, now);
  await db.batch([
    auditStatement(db, {
      actorId,
      action: 'job.tick',
      entityType: 'job',
      entityId: null,
      metadata: { inserted: String(inserted) },
      createdAt: now,
    }),
  ]);
  return { inserted };
}
