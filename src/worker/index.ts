import { createApp } from './app';
import { databaseIsReady } from './db';
import { runTick, vapidOptions } from './tick';

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      databaseIsReady(env.DB).then(async (ready) => {
        if (!ready) {
          console.log(JSON.stringify({ code: 'database_unavailable', job: 'tick' }));
          return;
        }
        try {
          await runTick(env.DB, Date.now(), null, vapidOptions(env));
        } catch (error) {
          console.log(
            JSON.stringify({
              code: 'tick_failed',
              job: 'tick',
              name: error instanceof Error ? error.name : 'Error',
            }),
          );
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;
