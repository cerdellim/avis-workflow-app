export type RuntimeSettings = {
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  inviteTtlMs: number;
  resetTtlMs: number;
  loginMaxFailures: number;
  loginWindowMs: number;
  dueSoonMs: number;
};

const FALLBACKS = {
  session_idle_hours: 12,
  session_absolute_days: 14,
  invite_ttl_hours: 168,
  reset_ttl_hours: 24,
  login_max_failures: 5,
  login_window_minutes: 15,
};

export async function loadSettings(db: D1Database): Promise<RuntimeSettings> {
  const rows = await db
    .prepare('SELECT key, value FROM app_settings')
    .all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  const read = (key: keyof typeof FALLBACKS): number => {
    const parsed = Number(values.get(key));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACKS[key];
  };
  const hour = 60 * 60 * 1000;
  const dueSoonHours = Number(values.get('due_soon_hours'));
  return {
    dueSoonMs: (Number.isFinite(dueSoonHours) && dueSoonHours > 0 ? dueSoonHours : 24) * hour,
    sessionIdleMs: read('session_idle_hours') * hour,
    sessionAbsoluteMs: read('session_absolute_days') * 24 * hour,
    inviteTtlMs: read('invite_ttl_hours') * hour,
    resetTtlMs: read('reset_ttl_hours') * hour,
    loginMaxFailures: read('login_max_failures'),
    loginWindowMs: read('login_window_minutes') * 60 * 1000,
  };
}
