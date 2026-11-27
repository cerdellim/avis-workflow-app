export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: 'volontari';
  database: 'ok' | 'error';
  time: string;
};

export function buildHealthBody(databaseReady: boolean, now: Date): HealthResponse {
  return {
    status: databaseReady ? 'ok' : 'degraded',
    service: 'volontari',
    database: databaseReady ? 'ok' : 'error',
    time: now.toISOString(),
  };
}
