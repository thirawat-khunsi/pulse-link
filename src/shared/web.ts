import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { renderStatusPage, sendHtml } from './html.js';

/** `web/dist` from both `src/shared/web.ts` (tsx) and `dist/shared/web.js` (built). */
export const DEFAULT_WEB_ROOT = resolve(fileURLToPath(import.meta.url), '../../../web/dist');

const UI_NOT_BUILT = renderStatusPage({
  status: 503,
  title: 'ยังไม่ได้ build หน้าเว็บ',
  message: 'รัน npm run build (หรือ npm run dev:web ระหว่างพัฒนา) แล้วเปิดหน้านี้ใหม่',
});

/**
 * Serve the Vite build (DECISIONS D-006):
 * - `GET /` returns index.html (hash routing, so no SPA fallback is needed);
 * - `/assets/*` serves hashed files with a long immutable cache.
 * Nothing is registered at the root wildcard, so `/:code` stays free for the redirect.
 */
export async function registerWebApp(app: FastifyInstance, webRoot: string): Promise<void> {
  const indexPath = join(webRoot, 'index.html');
  const built = existsSync(indexPath);
  if (!built) {
    app.log.warn({ webRoot }, 'web UI is not built; GET / will answer 503');
  }
  // Read once: index.html only changes on a new build, which means a new process.
  const indexHtml = built ? readFileSync(indexPath, 'utf8') : null;

  app.get('/', (_request, reply) => {
    if (indexHtml === null) return sendHtml(reply, 503, UI_NOT_BUILT);
    // Always revalidate the shell so a deploy picks up the new hashed asset names.
    return reply
      .header('cache-control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(indexHtml);
  });

  if (built) {
    await app.register(fastifyStatic, {
      root: join(webRoot, 'assets'),
      prefix: '/assets/',
      // Vite adds a content hash to every file name under /assets.
      maxAge: '365d',
      immutable: true,
      index: false,
      wildcard: true,
    });
  }
}
