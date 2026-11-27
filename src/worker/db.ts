export async function databaseIsReady(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT 1 AS ok FROM app_settings LIMIT 1')
      .first<{ ok: number }>();
    return row !== null;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    console.log(JSON.stringify({ code: 'database_unavailable', name }));
    return false;
  }
}
