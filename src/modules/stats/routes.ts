import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../shared/db.js';
import { requireOwnedLink } from '../../shared/ownedLink.js';
import { parseInput } from '../../shared/validation.js';
import { createStatsRepository } from './repository.js';
import { createStatsService } from './service.js';

export const statsQuery = z.object({
  days: z
    .enum(['7', '30'], { error: 'days ต้องเป็น 7 หรือ 30' })
    .default('7')
    .transform((v) => (v === '30' ? 30 : 7)),
});

export interface StatsRoutesOptions {
  db: Db;
}

/** `GET /api/links/:id/stats?days=7|30` (owner only). */
export const statsRoutes: FastifyPluginCallback<StatsRoutesOptions> = (app, options, done) => {
  const service = createStatsService(createStatsRepository(options.db));

  app.get('/:id/stats', async (request, reply) => {
    const { days } = parseInput(statsQuery, request.query);
    const link = await requireOwnedLink(options.db, request.params, request.ownerToken);
    // Polled every 5 s by the dashboard; always fresh.
    reply.header('cache-control', 'no-store');
    return service.forLink(link.id, days);
  });

  done();
};
