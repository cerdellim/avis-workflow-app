import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Profile } from '../shared/account';
import { ApiError } from '../shared/errors';
import { randomToken, sha256Hex } from './crypto';
import { loadProfile } from './profiles';
import { clientAddress } from './rate-limit';
import { loadSettings } from './settings';
import type { AppEnv } from './types';

export const SESSION_COOKIE = 'volontari_session';
const SEEN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_COOKIE_LENGTH = 200;

export type CurrentUser = Profile & {
  sessionId: string;
};

type SessionRow = {
  session_id: string;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
  id: string;
  status: string;
};

export async function openSession(c: Context<AppEnv>, userId: string, now: number): Promise<void> {
  const settings = await loadSettings(c.env.DB);
  const token = randomToken();
  const sessionId = await sha256Hex(token);
  const userAgent = c.req.header('user-agent')?.slice(0, 200) ?? null;
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, revoked_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      sessionId,
      userId,
      now,
      now + settings.sessionAbsoluteMs,
      now,
      userAgent,
      await sha256Hex(clientAddress(c.req.raw)),
    )
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    ...cookieOptions(c),
    maxAge: Math.floor(settings.sessionAbsoluteMs / 1000),
  });
  c.set('userId', userId);
}

export async function readSession(c: Context<AppEnv>): Promise<CurrentUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > MAX_COOKIE_LENGTH) {
    return null;
  }
  const sessionId = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, s.revoked_at, u.id, u.status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
  )
    .bind(sessionId)
    .first<SessionRow>();
  if (!row) {
    return null;
  }

  const now = Date.now();
  const settings = await loadSettings(c.env.DB);
  const expired =
    row.revoked_at !== null ||
    row.expires_at <= now ||
    now - row.last_seen_at > settings.sessionIdleMs ||
    row.status !== 'active';
  if (expired) {
    if (row.revoked_at === null) {
      await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
        .bind(now, row.session_id)
        .run();
    }
    return null;
  }

  if (now - row.last_seen_at >= SEEN_INTERVAL_MS) {
    await c.env.DB.prepare(
      'UPDATE sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
      .bind(now, row.session_id)
      .run();
  }

  const profile = await loadProfile(c.env.DB, row.id);
  if (!profile) {
    return null;
  }
  c.set('userId', profile.id);
  return { ...profile, sessionId: row.session_id };
}

export async function requireUser(c: Context<AppEnv>): Promise<CurrentUser> {
  const user = await readSession(c);
  if (!user) {
    throw new ApiError(401, 'unauthenticated', 'Accedi per continuare.');
  }
  return user;
}

export function requireAdmin(user: CurrentUser): void {
  if (user.role !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Non hai i permessi per questa operazione.');
  }
}

export async function revokeSession(db: D1Database, sessionId: string, now: number): Promise<void> {
  await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now, sessionId)
    .run();
}

export function revokeAllStatement(
  db: D1Database,
  userId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(now, userId);
}

export function revokeOthersStatement(
  db: D1Database,
  userId: string,
  sessionId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
    )
    .bind(now, userId, sessionId);
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c));
}

function cookieOptions(c: Context<AppEnv>) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    secure: new URL(c.req.url).protocol === 'https:',
  };
}
