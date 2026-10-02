import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClickBuffer, type ClickWriter } from '../../src/modules/clicks/buffer.js';
import { createClickWriter } from '../../src/modules/clicks/repository.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { OWNER_COOKIE } from '../../src/shared/owner.js';
import { buildTestApp } from '../helpers/app.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();
const OWNER = '11111111-1111-4111-8111-111111111111';
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const LINE_PREVIEW = 'facebookexternalhit/1.1;line-poker/1.0';

interface LinkFields {
  code: string;
  target?: string;
  isActive?: boolean;
  expiresAt?: string | null; // SQL expression
  maxClicks?: number | null;
  clickCount?: number;
}

describe.skipIf(!url)('GET /:code (requires TEST_DATABASE_URL)', () => {
  let db: Db;
  let app: FastifyInstance;
  let buffer: ClickBuffer;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
  });

  function start(writer: ClickWriter = createClickWriter(db), flushIntervalMs = 60_000) {
    buffer = new ClickBuffer({ writer, flushIntervalMs, closeTimeoutMs: 200 });
    app = buildTestApp({ db, clicks: buffer });
  }

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
    start();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await db.end();
  });

  async function insertLink(f: LinkFields): Promise<number> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO links (owner_token, code, target_url, is_active, expires_at, max_clicks, click_count)
       VALUES ($1, $2, $3, $4, ${f.expiresAt ?? 'NULL'}, $5, $6) RETURNING id`,
      [
        OWNER,
        f.code,
        f.target ?? 'https://example.com/landing',
        f.isActive ?? true,
        f.maxClicks ?? null,
        f.clickCount ?? 0,
      ],
    );
    return Number(rows[0]?.id);
  }

  const visit = (path: string, headers: Record<string, string> = { 'user-agent': PHONE }) =>
    app.inject({ method: 'GET', url: path, headers });

  async function stored() {
    await buffer.flush();
    const { rows: clicks } = await db.query<{
      link_id: string;
      source: string;
      device: string;
      browser: string | null;
      referrer_host: string | null;
      is_bot: boolean;
    }>('SELECT link_id, source, device, browser, referrer_host, is_bot FROM clicks ORDER BY id');
    const { rows: links } = await db.query<{ code: string; click_count: number }>(
      'SELECT code, click_count FROM links ORDER BY id',
    );
    return { clicks, counts: Object.fromEntries(links.map((l) => [l.code, l.click_count])) };
  }

  describe('302', () => {
    it('redirects with no-store and records the click after the response', async () => {
      await insertLink({ code: 'abc123' });
      const res = await visit('/abc123', {
        'user-agent': PHONE,
        referer: 'https://www.facebook.com/groups/x?secret=1',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://example.com/landing');
      expect(res.headers['cache-control']).toBe('no-store');

      // Nothing is written until the buffer flushes.
      expect((await db.query('SELECT 1 FROM clicks')).rowCount).toBe(0);
      expect(await stored()).toEqual({
        clicks: [
          {
            link_id: '1',
            source: 'click',
            device: 'mobile',
            browser: 'Mobile Safari',
            referrer_host: 'www.facebook.com',
            is_bot: false,
          },
        ],
        counts: { abc123: 1 },
      });
    });

    it.each([
      ['?s=qr', 'qr'],
      ['?s=QR', 'click'],
      ['?s=other', 'click'],
      ['?utm_source=x', 'click'],
    ])('%s → source=%s', async (query, source) => {
      await insertLink({ code: 'abc123' });
      expect((await visit(`/abc123${query}`)).statusCode).toBe(302);
      expect((await stored()).clicks.map((c) => c.source)).toEqual([source]);
    });
  });

  describe('404 and 410', () => {
    it('unknown code → Thai 404 page, and the miss is cached', async () => {
      const query = vi.spyOn(db, 'query');
      const first = await visit('/nothing');
      const second = await visit('/nothing');
      expect(first.statusCode).toBe(404);
      expect(first.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body).toContain('ไม่พบลิงก์นี้');
      expect(second.statusCode).toBe(404);
      expect(query).toHaveBeenCalledTimes(1);
      query.mockRestore();
    });

    it.each([
      ['disabled', { isActive: false }, 'ลิงก์นี้ถูกปิดใช้งาน'],
      ['expired', { expiresAt: "now() - interval '1 second'" }, 'ลิงก์นี้หมดอายุแล้ว'],
      ['exhausted', { maxClicks: 2, clickCount: 2 }, 'ลิงก์นี้ถูกใช้ครบจำนวนแล้ว'],
    ])('%s → 410 with its own Thai message', async (_reason, fields, title) => {
      await insertLink({ code: 'gone01', ...fields });
      const res = await visit('/gone01');
      expect(res.statusCode).toBe(410);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toContain(title);
      expect((await stored()).clicks).toHaveLength(0);
    });

    it('evaluates expiry on every request, even for a cached link', async () => {
      await insertLink({ code: 'soon01', expiresAt: "now() + interval '300 milliseconds'" });
      expect((await visit('/soon01')).statusCode).toBe(302);
      await new Promise((r) => setTimeout(r, 400));
      expect((await visit('/soon01')).statusCode).toBe(410);
    });
  });

  describe('HEAD and bots (DECISIONS D-001)', () => {
    it('HEAD gets the same 302 but is never recorded or counted', async () => {
      await insertLink({ code: 'plain1' });
      await insertLink({ code: 'limit1', maxClicks: 1 });
      for (const path of ['/plain1', '/limit1']) {
        const res = await app.inject({
          method: 'HEAD',
          url: path,
          headers: { 'user-agent': PHONE },
        });
        expect(res.statusCode).toBe(302);
        expect(res.body).toBe('');
      }
      expect(await stored()).toEqual({ clicks: [], counts: { plain1: 0, limit1: 0 } });
      // The quota is still intact for a person.
      expect((await visit('/limit1')).statusCode).toBe(302);
    });

    it('a bot is redirected and recorded as a bot, without counting or consuming max_clicks', async () => {
      await insertLink({ code: 'plain1' });
      await insertLink({ code: 'limit1', maxClicks: 1 });
      for (const path of ['/plain1', '/limit1', '/limit1']) {
        expect((await visit(path, { 'user-agent': LINE_PREVIEW })).statusCode).toBe(302);
      }
      const { clicks, counts } = await stored();
      expect(counts).toEqual({ plain1: 0, limit1: 0 });
      expect(clicks.map((c) => [c.is_bot, c.device])).toEqual([
        [true, 'bot'],
        [true, 'bot'],
        [true, 'bot'],
      ]);
      expect((await visit('/limit1')).statusCode).toBe(302);
    });

    it('a bot gets 410 once the limit is reached, like a person', async () => {
      await insertLink({ code: 'limit1', maxClicks: 1, clickCount: 1 });
      expect((await visit('/limit1', { 'user-agent': LINE_PREVIEW })).statusCode).toBe(410);
    });

    it('a request without User-Agent is a bot; curl is a person (D-019)', async () => {
      await insertLink({ code: 'plain1' });
      // light-my-request adds its own User-Agent unless one is given.
      await visit('/plain1', { 'user-agent': '' });
      await visit('/plain1', { 'user-agent': 'curl/8.4.0' });
      const { clicks, counts } = await stored();
      expect(clicks.map((c) => [c.is_bot, c.browser]).sort()).toEqual([
        [false, 'curl'],
        [true, null],
      ]);
      expect(counts).toEqual({ plain1: 1 });
    });
  });

  describe('max_clicks', () => {
    it('lets exactly max_clicks concurrent visitors through and never double-counts', async () => {
      await insertLink({ code: 'limit5', maxClicks: 5 });
      const results = await Promise.all(Array.from({ length: 20 }, () => visit('/limit5')));
      const statuses = results.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 302)).toHaveLength(5);
      expect(statuses.filter((s) => s === 410)).toHaveLength(15);
      expect(results.find((r) => r.statusCode === 410)?.body).toContain('ครบจำนวน');

      const { clicks, counts } = await stored();
      expect(counts).toEqual({ limit5: 5 }); // atomic UPDATE counted them; flush must not add again
      expect(clicks).toHaveLength(5);
    });

    it('decides from the database, not the cache (a plain link may stay stale up to the TTL)', async () => {
      await insertLink({ code: 'limit9', maxClicks: 9 });
      await insertLink({ code: 'plain1' });
      expect((await visit('/limit9')).statusCode).toBe(302);
      expect((await visit('/plain1')).statusCode).toBe(302);

      // Disabled behind the cache's back (another process, no invalidation).
      await db.query('UPDATE links SET is_active = false');
      expect((await visit('/limit9')).statusCode).toBe(410);
      expect((await visit('/plain1')).statusCode).toBe(302); // documented staleness, D-004
    });
  });

  describe('never delayed by click logging', () => {
    it('answers while the click writer hangs', async () => {
      await app.close();
      let writes = 0;
      start({ write: () => (writes++, new Promise<void>(() => undefined)) }, 10);
      await insertLink({ code: 'abc123' });

      const startedAt = performance.now();
      for (let i = 0; i < 50; i++) expect((await visit('/abc123')).statusCode).toBe(302);
      expect(performance.now() - startedAt).toBeLessThan(2000);
      await new Promise((r) => setTimeout(r, 30));
      expect(writes).toBe(1); // a flush started and is stuck; redirects did not wait for it
    });

    it('answers while the click writer fails (database outage)', async () => {
      await app.close();
      const write = vi.fn(() => Promise.reject(new Error('db down')));
      start({ write }, 10);
      await insertLink({ code: 'abc123' });
      for (let i = 0; i < 5; i++) {
        expect((await visit('/abc123')).statusCode).toBe(302);
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(write).toHaveBeenCalled();
      expect(buffer.size).toBe(5); // kept for retry
    });
  });

  describe('cache invalidation through the links API (same process)', () => {
    const apiCall = (method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
      app.inject({
        method,
        url: `/api/links${path}`,
        cookies: { [OWNER_COOKIE]: OWNER },
        ...(payload ? { payload } : {}),
      });

    it('a new alias works immediately even after its miss was cached', async () => {
      expect((await visit('/coffee')).statusCode).toBe(404); // cached as missing for 10 s
      const created = await apiCall('POST', '', {
        url: 'https://coffee.example/',
        alias: 'coffee',
      });
      expect(created.statusCode).toBe(201);
      expect((await visit('/coffee')).statusCode).toBe(302);
    });

    it('PATCH and DELETE take effect immediately for a cached plain link', async () => {
      const id = await insertLink({ code: 'plain1' });
      expect((await visit('/plain1')).statusCode).toBe(302); // now cached for 60 s

      expect((await apiCall('PATCH', `/${id}`, { isActive: false })).statusCode).toBe(200);
      expect((await visit('/plain1')).statusCode).toBe(410);

      expect((await apiCall('PATCH', `/${id}`, { isActive: true })).statusCode).toBe(200);
      expect((await visit('/plain1')).statusCode).toBe(302);

      // Adding a limit moves the link to the atomic path at once.
      expect((await apiCall('PATCH', `/${id}`, { maxClicks: 1 })).statusCode).toBe(200);
      expect((await visit('/plain1')).statusCode).toBe(302);
      expect((await visit('/plain1')).statusCode).toBe(410);

      expect((await apiCall('DELETE', `/${id}`)).statusCode).toBe(204);
      expect((await visit('/plain1')).statusCode).toBe(404);
    });
  });

  describe('Thai aliases', () => {
    it.each([
      ['literal', '/กาแฟ'],
      ['percent-encoded', `/${encodeURIComponent('กาแฟ')}`],
      ['lower-case hex', `/${encodeURIComponent('กาแฟ').toLowerCase()}`],
    ])('/กาแฟ %s → 302', async (_name, path) => {
      await insertLink({ code: 'กาแฟ', target: 'https://coffee.example/' });
      const res = await visit(path);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://coffee.example/');
    });

    it('normalises mark order (NFC) and Latin case', async () => {
      await insertLink({ code: '\u0E01\u0E38\u0E48\u0E21', target: 'https://group.example/' });
      await insertLink({ code: 'coffee-01', target: 'https://latin.example/' });
      const reordered = `/${encodeURIComponent('\u0E01\u0E48\u0E38\u0E21')}`;
      expect((await visit(reordered)).headers.location).toBe('https://group.example/');
      expect((await visit('/COFFEE-01')).headers.location).toBe('https://latin.example/');
    });

    it('works over a real socket with a browser-style encoded path', async () => {
      await insertLink({ code: 'กาแฟ', target: 'https://coffee.example/' });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const res = await new Promise<{ status?: number; location?: string }>((resolve, reject) => {
        get({ host: '127.0.0.1', port, path: `/${encodeURIComponent('กาแฟ')}` }, (r) => {
          r.resume();
          resolve({ status: r.statusCode, location: r.headers.location });
        }).on('error', reject);
      });
      expect(res).toEqual({ status: 302, location: 'https://coffee.example/' });
    });
  });
});
