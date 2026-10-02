import type { FastifyPluginCallback } from 'fastify';
import { normalizeCode } from '../../shared/alias.js';
import { isBot } from '../../shared/bot.js';
import { NOT_FOUND_PAGE, sendHtml } from '../../shared/html.js';
import type { Db } from '../../shared/db.js';
import type { ClickSink } from '../clicks/buffer.js';
import type { LinkCache } from './cache.js';
import { GONE_PAGES } from './pages.js';
import { createRedirectRepository } from './repository.js';
import { createResolver } from './resolver.js';

export interface RedirectRoutesOptions {
  db: Db;
  cache: LinkCache;
  clicks: ClickSink;
}

/**
 * `GET /:code` (HEAD is registered automatically by Fastify and never logged).
 * Static routes such as /health, /api/* and /assets/* always win over this parametric
 * route in find-my-way, and `:code` only matches a single path segment.
 */
export const redirectRoutes: FastifyPluginCallback<RedirectRoutesOptions> = (
  app,
  options,
  done,
) => {
  const resolver = createResolver(createRedirectRepository(options.db), options.cache);

  app.get<{ Params: { code: string }; Querystring: { s?: unknown } }>(
    '/:code',
    async (request, reply) => {
      // Fastify has already percent-decoded the segment; see also frameworkErrors in app.ts.
      const code = normalizeCode(request.params.code);
      const isHead = request.method === 'HEAD';
      const userAgent = request.headers['user-agent'];
      const bot = isBot(userAgent);

      const result = await resolver.resolve(code, { countable: !isHead && !bot });
      if (result.kind === 'not_found') return sendHtml(reply, 404, NOT_FOUND_PAGE);
      if (result.kind === 'gone') return sendHtml(reply, 410, GONE_PAGES[result.reason]);

      if (!isHead) {
        // Synchronous push into memory; the database write happens later in a batch.
        options.clicks.enqueue({
          linkId: result.linkId,
          clickedAt: new Date(),
          source: request.query.s === 'qr' ? 'qr' : 'click',
          userAgent,
          referer: request.headers.referer,
          isBot: bot,
          counted: result.counted,
        });
      }
      // 302 only: a 301 would be cached by browsers and later clicks would never be counted.
      return reply.header('cache-control', 'no-store').redirect(result.targetUrl, 302);
    },
  );

  done();
};
