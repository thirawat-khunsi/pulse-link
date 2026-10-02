import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app.js';
import { type AppMode, loadConfig, loadDotEnv } from './shared/config.js';
import { createPool } from './shared/db.js';

export interface StartServerOptions {
  /** Used by the per-mode entrypoints; otherwise APP_MODE decides. */
  mode?: AppMode;
  /** Test seams. */
  port?: number;
  logger?: FastifyServerOptions['logger'];
  exit?: (code: number) => void;
}

export interface RunningServer {
  app: FastifyInstance;
  /** Same path as SIGTERM/SIGINT; resolves after exit was requested. */
  shutdown: (signal: string) => Promise<void>;
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Start an HTTP server and bind SIGTERM/SIGINT to a graceful shutdown:
 * stop accepting requests and finish in-flight ones (app.close), which drains the click
 * buffer in its onClose hook, then close the pool, then exit.
 */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  loadDotEnv();
  const config = loadConfig();
  const mode = options.mode ?? config.APP_MODE;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  const db = createPool(config.DATABASE_URL);
  const app = buildApp({
    mode,
    db,
    baseUrl: config.BASE_URL,
    secureCookies: config.NODE_ENV === 'production',
    clickFlushMs: config.CLICK_FLUSH_MS,
    trustProxy: config.TRUST_PROXY,
    logger: options.logger ?? { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
  });

  let closing: Promise<void> | null = null;
  const shutdown = (signal: string): Promise<void> => {
    closing ??= (async () => {
      app.log.info({ signal }, 'shutting down');
      for (const s of SIGNALS) process.removeListener(s, onSignal);
      try {
        await app.close();
        // Only after app.close(): the click buffer's final flush still needs the pool.
        await db.end();
        exit(0);
      } catch (err) {
        app.log.error(err, 'error during shutdown');
        exit(1);
      }
    })();
    return closing;
  };
  const onSignal = (signal: NodeJS.Signals) => void shutdown(signal);
  for (const s of SIGNALS) process.once(s, onSignal);

  await app.listen({ port: options.port ?? config.PORT, host: '0.0.0.0' });
  app.log.info({ mode }, 'pulse-link started');
  return { app, shutdown };
}

export function runServer(mode?: AppMode): void {
  startServer({ mode }).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
