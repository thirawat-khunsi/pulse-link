import { describe, expect, it } from 'vitest';
import type { AppMode } from '../../src/shared/config.js';
import { buildTestApp, unusedPool } from '../helpers/app.js';

type Expect = [status: number, kind: 'json' | 'html'];

// None of these paths may reach the database: the pool is never connected.
const MATRIX: [method: 'GET' | 'POST', path: string, Record<AppMode, Expect>][] = [
  ['GET', '/health', { all: [200, 'json'], api: [200, 'json'], redirect: [200, 'json'] }],
  ['POST', '/api/links', { all: [400, 'json'], api: [400, 'json'], redirect: [404, 'json'] }],
  ['GET', '/api/nope', { all: [404, 'json'], api: [404, 'json'], redirect: [404, 'json'] }],
  // "/api" alone is one segment: /:code sees the reserved word and answers 404 without a query.
  ['GET', '/api', { all: [404, 'html'], api: [404, 'json'], redirect: [404, 'html'] }],
  // find-my-way passes an empty :code for "/"; it must not be looked up.
  ['GET', '/', { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] }],
  ['GET', '/favicon.ico', { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] }],
  ['GET', '/robots.txt', { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] }],
  ['GET', '/a/b', { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] }],
  [
    'GET',
    `/${'x'.repeat(65)}`,
    { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] },
  ],
  // Malformed percent-encoding: same Thai 404 page as an unknown link.
  ['GET', '/%E0%B8', { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] }],
  ['GET', '/%zz', { all: [404, 'html'], api: [404, 'html'], redirect: [404, 'html'] }],
  ['GET', '/api/links/%E0%B8', { all: [404, 'json'], api: [404, 'json'], redirect: [404, 'json'] }],
];

describe.each(['all', 'api', 'redirect'] as const)('routing in APP_MODE=%s', (mode) => {
  it.each(MATRIX)('%s %s', async (method, path, expected) => {
    const app = buildTestApp({ mode, db: unusedPool() });
    const res = await app.inject({
      method,
      url: path,
      payload: method === 'POST' ? {} : undefined,
    });
    await app.close();

    const [status, kind] = expected[mode];
    expect(res.statusCode).toBe(status);
    if (kind === 'html') {
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toContain('<html lang="th">');
      expect(res.body).toContain('ไม่พบลิงก์นี้');
    } else {
      expect(res.headers['content-type']).toMatch(/^application\/json/);
    }
    // Fastify's own error text never reaches the client.
    expect(res.body).not.toMatch(/FST_|not a valid url component|Route GET/);
  });
});
