import { buildApp } from './app.js';
import { type AppMode, loadConfig, loadDotEnv } from './shared/config.js';
import { createPool } from './shared/db.js';

/**
 * Start an HTTP server. `modeOverride` is used by the per-mode entrypoints;
 * otherwise APP_MODE from the environment decides.
 */
export async function startServer(modeOverride?: AppMode): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const mode = modeOverride ?? config.APP_MODE;

  const db = createPool(config.DATABASE_URL);
  const app = buildApp({
    mode,
    trustProxy: config.TRUST_PROXY,
    logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
  });
  app.addHook('onClose', async () => {
    await db.end();
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error(err, 'error during shutdown');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ mode }, 'pulse-link started');
}

export function runServer(modeOverride?: AppMode): void {
  startServer(modeOverride).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
