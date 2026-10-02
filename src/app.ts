import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { linksRoutes } from './modules/links/routes.js';
import type { AppMode, TrustProxy } from './shared/config.js';
import type { Db } from './shared/db.js';
import { AppError, registerErrorHandling } from './shared/errors.js';
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
  });

  registerErrorHandling(app);
  void app.register(helmet);

  app.get('/health', () => ({ ok: true, mode: options.mode }));

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
        });
      },
      { prefix: '/api' },
    );
  }

  return app;
}

export function servesApi(mode: AppMode): boolean {
  return mode === 'all' || mode === 'api';
}

export function servesRedirect(mode: AppMode): boolean {
  return mode === 'all' || mode === 'redirect';
}
