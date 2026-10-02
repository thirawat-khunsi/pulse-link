import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClickBuffer } from '../../src/modules/clicks/buffer.js';
import { createClickWriter } from '../../src/modules/clicks/repository.js';
import type { LinkDto } from '../../src/modules/links/service.js';
import type { LinkStats } from '../../src/modules/stats/service.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { OWNER_COOKIE } from '../../src/shared/owner.js';
import { buildTestApp } from '../helpers/app.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();
const ALICE = '11111111-1111-4111-8111-111111111111';
const UA = {
  phone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  desktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  curl: 'curl/8.4.0',
  linePreview: 'facebookexternalhit/1.1;line-poker/1.0',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

/**
 * D-018 end to end: traffic goes through the real redirect and click buffer, then the history
 * list, link detail and stats must all report the same non-bot clicks and scans.
 */
describe.skipIf(!url)('clickCount / qrScanCount consistency (requires TEST_DATABASE_URL)', () => {
  let db: Db;
  let app: FastifyInstance;
  let buffer: ClickBuffer;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
    buffer = new ClickBuffer({ writer: createClickWriter(db), flushIntervalMs: 60_000 });
    app = buildTestApp({ db, clicks: buffer });
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  const api = (method: 'GET' | 'POST', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/links${path}`,
      cookies: { [OWNER_COOKIE]: ALICE },
      ...(payload ? { payload } : {}),
    });

  it.each([
    ['a plain link (counted at flush)', {}],
    ['a max_clicks link (counted by the atomic UPDATE)', { maxClicks: 100 }],
  ])('%s', async (_name, extra) => {
    const created = await api('POST', '', {
      url: 'https://example.com/',
      alias: 'pulse',
      ...extra,
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<LinkDto>();

    const visits: [method: 'GET' | 'HEAD', query: string, ua: string][] = [
      ['GET', '', UA.phone],
      ['GET', '', UA.desktop],
      ['GET', '', UA.curl], // people (D-019)
      ['GET', '', UA.phone],
      ['GET', '?s=qr', UA.phone],
      ['GET', '?s=qr', UA.phone],
      ['GET', '', UA.linePreview], // bot click
      ['GET', '?s=qr', UA.googlebot], // bot scan
      ['HEAD', '', UA.phone], // never recorded
      ['HEAD', '?s=qr', UA.phone],
    ];
    for (const [method, query, ua] of visits) {
      const res = await app.inject({
        method,
        url: `/pulse${query}`,
        headers: { 'user-agent': ua },
      });
      expect(res.statusCode).toBe(302);
    }
    await buffer.flush();

    const expected = { clickCount: 4, qrScanCount: 2 };
    const [listed] = (await api('GET', '')).json<{ items: LinkDto[] }>().items;
    expect(listed).toMatchObject(expected);
    expect((await api('GET', `/${id}`)).json<LinkDto>()).toMatchObject(expected);

    const stats = (await api('GET', `/${id}/stats`)).json<LinkStats>();
    expect(stats.totals).toEqual({ clicks: 4, qrScans: 2, bots: 2 });
    const today = stats.byDay.at(-1);
    expect(today).toMatchObject({ clicks: 4, qrScans: 2 });
    expect(stats.recent).toHaveLength(6);
    expect(stats.byDevice).toEqual([
      { device: 'mobile', count: 4 },
      { device: 'desktop', count: 1 },
      { device: 'unknown', count: 1 },
    ]);

    // links.click_count enforces max_clicks and includes scans; it is never what the API shows.
    const { rows } = await db.query('SELECT click_count FROM links WHERE id = $1', [id]);
    expect(rows).toEqual([{ click_count: 6 }]);
  });
});
