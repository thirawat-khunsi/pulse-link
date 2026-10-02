import type { FastifyPluginCallback } from 'fastify';
import type { Db } from '../../shared/db.js';
import { AppError } from '../../shared/errors.js';
import { linkNotFound, parseLinkId } from '../../shared/ownedLink.js';
import { parseInput } from '../../shared/validation.js';
import { createLinkRepository } from './repository.js';
import { createLinkBody, listLinksQuery, updateLinkBody } from './schemas.js';
import { createLinkService } from './service.js';

export interface LinksRoutesOptions {
  db: Db;
  baseUrl: string;
  onLinkChanged?: (code: string) => void;
}

/** SPEC §7: link creation is limited separately from the rest of /api. */
export const CREATE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };

/** `/api/links` CRUD. Expects `request.ownerToken` to be set by the enclosing scope. */
export const linksRoutes: FastifyPluginCallback<LinksRoutesOptions> = (app, options, done) => {
  const service = createLinkService(createLinkRepository(options.db), {
    baseUrl: options.baseUrl,
    onLinkChanged: options.onLinkChanged,
  });

  function idParam(params: unknown): number {
    const id = parseLinkId((params as { id: string }).id);
    if (id === null) throw linkNotFound();
    return id;
  }

  app.post('/', { config: { rateLimit: CREATE_RATE_LIMIT } }, async (request, reply) => {
    const input = parseInput(createLinkBody, request.body);
    return reply.status(201).send(await service.create(request.ownerToken, input));
  });

  app.get('/', async (request) => {
    const { limit, cursor } = parseInput(listLinksQuery, request.query);
    return service.list(request.ownerToken, limit, cursor);
  });

  app.get('/:id', async (request) => {
    return service.get(request.ownerToken, idParam(request.params));
  });

  app.patch('/:id', async (request) => {
    const id = idParam(request.params);
    const body = request.body as Record<string, unknown> | null | undefined;
    if (body && typeof body === 'object' && ('url' in body || 'targetUrl' in body)) {
      throw new AppError(400, 'TARGET_URL_IMMUTABLE', 'แก้ไข URL ปลายทางของลิงก์ไม่ได้');
    }
    return service.update(request.ownerToken, id, parseInput(updateLinkBody, body));
  });

  app.delete('/:id', async (request, reply) => {
    await service.remove(request.ownerToken, idParam(request.params));
    return reply.status(204).send();
  });

  done();
};
