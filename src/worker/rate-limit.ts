import { ApiError } from '../shared/errors';
import { sha256Hex } from './crypto';

const MESSAGE = 'Troppi tentativi. Riprova più tardi.';

export function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local';
}

export async function assertAttemptLimit(
  db: D1Database,
  scope: 'login' | 'setup' | 'invite' | 'password_reset',
  subject: string,
  max: number,
  windowMs: number,
  now: number,
): Promise<void> {
  const subjectHash = await sha256Hex(subject);
  const since = now - windowMs;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(attempted_at) AS oldest
       FROM auth_attempts
       WHERE scope = ? AND subject_hash = ? AND success = 0 AND attempted_at > ?`,
    )
    .bind(scope, subjectHash, since)
    .first<{ n: number; oldest: number | null }>();
  const count = Number(row?.n ?? 0);
  if (count < max) {
    return;
  }
  const oldest = Number(row?.oldest ?? now);
  const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
  throw new ApiError(429, 'rate_limited', MESSAGE, { retryAfterSeconds });
}

export async function recordAttempt(
  db: D1Database,
  scope: 'login' | 'setup' | 'invite' | 'password_reset',
  subject: string,
  success: boolean,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_attempts (id, scope, subject_hash, attempted_at, success)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), scope, await sha256Hex(subject), now, success ? 1 : 0)
    .run();
}
