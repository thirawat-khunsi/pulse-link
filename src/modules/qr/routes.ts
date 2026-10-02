import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../shared/db.js';
import { requireOwnedLink } from '../../shared/ownedLink.js';
import { parseInput } from '../../shared/validation.js';
import { contentDisposition, qrTarget, renderQr } from './service.js';

export const QR_MIN_SIZE = 128;
export const QR_MAX_SIZE = 2048;
const SIZE_INVALID = `ขนาด QR ต้องเป็นจำนวนเต็ม ${QR_MIN_SIZE}-${QR_MAX_SIZE} พิกเซล`;

const qrQuery = z.object({
  format: z.enum(['png', 'svg'], { error: 'รูปแบบไฟล์ต้องเป็น png หรือ svg' }).default('png'),
  size: z.coerce
    .number({ error: SIZE_INVALID })
    .int({ error: SIZE_INVALID })
    .min(QR_MIN_SIZE, { error: SIZE_INVALID })
    .max(QR_MAX_SIZE, { error: SIZE_INVALID })
    .default(512),
  // Only "1" asks for a download; anything else renders inline.
  download: z
    .unknown()
    .optional()
    .transform((v) => v === '1'),
});

const CONTENT_TYPES = { png: 'image/png', svg: 'image/svg+xml' } as const;

export interface QrRoutesOptions {
  db: Db;
  baseUrl: string;
}

/** `GET /api/links/:id/qr` (owner only). */
export const qrRoutes: FastifyPluginCallback<QrRoutesOptions> = (app, options, done) => {
  app.get('/:id/qr', async (request, reply) => {
    const { format, size, download } = parseInput(qrQuery, request.query);
    const link = await requireOwnedLink(options.db, request.params, request.ownerToken);
    const image = await renderQr(qrTarget(options.baseUrl, link.code), format, size);

    reply
      .type(CONTENT_TYPES[format])
      // Content only changes with BASE_URL; private because it needs the owner's cookie.
      .header('cache-control', 'private, max-age=86400');
    // qrcode's SVG has no scripts; this keeps it inert even if opened directly.
    if (format === 'svg') reply.header('content-security-policy', "default-src 'none'");
    if (download)
      reply.header('content-disposition', contentDisposition(link.id, link.code, format));
    return reply.send(image);
  });

  done();
};
