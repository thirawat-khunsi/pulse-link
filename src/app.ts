import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ClickBuffer, type ClickSink } from './modules/clicks/buffer.js';
import { createClickWriter } from './modules/clicks/repository.js';
import { linksRoutes } from './modules/links/routes.js';
import { qrRoutes } from './modules/qr/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { LinkCache } from './modules/redirect/cache.js';
import { redirectRoutes } from './modules/redirect/routes.js';
import type { AppMode, TrustProxy } from './shared/config.js';
import type { Db } from './shared/db.js';
import { AppError, handleFrameworkError, registerErrorHandling } from './shared/errors.js';
import { registerOwnerCookie } from './shared/owner.js';

export interface BuildAppOptions {
  mode: AppMode;
  db: Db;
  /** Public origin without trailing slash (short URLs, self-link check). */
  baseUrl: string;
  /** Secure cookies (production). */
  secureCookies?: boolean;
  trustProxy?: TrustProxy;
  logger?: FastifyServerOptions['logger'];
  /** CLICK_FLUSH_MS (default 1000). */
  clickFlushMs?: number;
  /** Test seams: replace the click buffer or the link cache. */
  clicks?: ClickSink & { close(): Promise<void> };
  cache?: LinkCache;
}

/** SPEC §7: every /api route shares this per-IP budget unless it sets its own. */
export const API_RATE_LIMIT = { max: 300, timeWindow: '1 minute' };

/**
 * Build the Fastify instance for a given APP_MODE:
 * - `all`:      /api + static + /:code + /health
 * - `api`:      /api + static + /health
 * - `redirect`: /:code + /health
 * Feature modules are registered here as they are implemented.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
    // Thai aliases are ~9 chars per letter when percent-encoded (DECISIONS D-007).
    routerOptions: { maxParamLength: 512 },
    frameworkErrors: handleFrameworkError,
  });

  registerErrorHandling(app);
  void app.register(helmet);

  // Polled by Docker/host health checks every few seconds: keep it out of the info logs.
  app.get('/health', { logLevel: 'warn' }, () => ({ ok: true, mode: options.mode }));

  // One cache per process, shared by the redirect (reads) and the links API (invalidates).
  // In APP_MODE=api there is no redirect here, so invalidation is a no-op (D-004).
  const cache = options.cache ?? new LinkCache();

  if (servesApi(options.mode)) {
    void app.register(
      async (api) => {
        // JSON only: text/plain bodies would allow cross-site "simple" form posts.
        api.removeContentTypeParser('text/plain');
        await api.register(cookie);
        await api.register(rateLimit, {
          ...API_RATE_LIMIT,
          errorResponseBuilder: () =>
            new AppError(429, 'RATE_LIMITED', 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่'),
        });
        registerOwnerCookie(api, { secure: options.secureCookies ?? false });
        await api.register(linksRoutes, {
          prefix: '/links',
          db: options.db,
          baseUrl: options.baseUrl,
          onLinkChanged: (code) => {
            cache.invalidate(code);
          },
        });
        await api.register(qrRoutes, {
          prefix: '/links',
          db: options.db,
          baseUrl: options.baseUrl,
        });
        await api.register(statsRoutes, { prefix: '/links', db: options.db });
      },
      { prefix: '/api' },
    );
  }

  if (servesRedirect(options.mode)) {
    const clicks =
      options.clicks ??
      new ClickBuffer({
        writer: createClickWriter(options.db),
        flushIntervalMs: options.clickFlushMs ?? 1000,
        logger: app.log,
      });
    // Runs before the caller's own onClose hooks (e.g. closing the pool), so the last clicks land.
    app.addHook('onClose', async () => {
      await clicks.close();
    });
    void app.register(redirectRoutes, { db: options.db, cache, clicks });
  }

  return app;
}

export function servesApi(mode: AppMode): boolean {
  return mode === 'all' || mode === 'api';
}

export function servesRedirect(mode: AppMode): boolean {
  return mode === 'all' || mode === 'redirect';
}
