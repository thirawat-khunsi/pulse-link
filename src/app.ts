import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppMode, TrustProxy } from './shared/config.js';

export interface BuildAppOptions {
  mode: AppMode;
  trustProxy?: TrustProxy;
  logger?: FastifyServerOptions['logger'];
}

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

  app.get('/health', () => ({ ok: true, mode: options.mode }));

  return app;
}

export function servesApi(mode: AppMode): boolean {
  return mode === 'all' || mode === 'api';
}

export function servesRedirect(mode: AppMode): boolean {
  return mode === 'all' || mode === 'redirect';
}
