import { Hono } from 'hono';
import { ApiError, errorBody } from '../shared/errors';
import { buildHealthBody } from '../shared/health';
import { databaseIsReady } from './db';
import { mountAdmin } from './routes/admin';
import { mountAuth } from './routes/auth';
import { mountDirectory } from './routes/directory';
import { mountChecklists } from './routes/checklists';
import { mountNotifications } from './routes/notifications';
import { mountRecurrences } from './routes/recurrences';
import { mountTasks } from './routes/tasks';
import type { AppEnv } from './types';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (c.req.path.startsWith('/api')) {
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    }
    c.header('Cache-Control', 'no-store');
    await next();
    const entry: Record<string, string | number> = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - started,
    };
    const userId = c.get('userId');
    const errorCode = c.get('errorCode');
    if (userId) {
      entry.userId = userId;
    }
    if (errorCode) {
      entry.errorCode = errorCode;
    }
    console.log(JSON.stringify(entry));
  });

  app.get('/api/health', async (c) => {
    const ready = await databaseIsReady(c.env.DB);
    const body = buildHealthBody(ready, new Date());
    return c.json(body, body.status === 'ok' ? 200 : 503);
  });

  mountAuth(app);
  mountAdmin(app);
  mountDirectory(app);
  mountTasks(app);
  mountNotifications(app);
  mountChecklists(app);
  mountRecurrences(app);

  app.notFound((c) => {
    return c.json({ error: { code: 'not_found', message: 'Risorsa non trovata.' } }, 404);
  });

  app.onError((error, c) => {
    if (error instanceof SyntaxError) {
      c.set('errorCode', 'validation_error');
      return c.json(
        { error: { code: 'validation_error', message: 'Il corpo della richiesta non è valido.' } },
        400,
      );
    }
    const mapped = errorBody(error);
    c.set('errorCode', mapped.body.error.code);
    if (error instanceof ApiError && error.retryAfterSeconds !== undefined) {
      c.header('Retry-After', String(error.retryAfterSeconds));
    }
    if (mapped.status === 500) {
      console.log(
        JSON.stringify({
          requestId: c.get('requestId'),
          code: 'internal_error',
          name: error.name,
        }),
      );
    }
    return c.json(mapped.body, mapped.status);
  });

  return app;
}
