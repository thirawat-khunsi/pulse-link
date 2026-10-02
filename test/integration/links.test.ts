import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LinkDto } from '../../src/modules/links/service.js';
import { encodeId } from '../../src/shared/code.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { OWNER_COOKIE } from '../../src/shared/owner.js';
import { buildTestApp, TEST_BASE_URL } from '../helpers/app.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!url)('/api/links (requires TEST_DATABASE_URL)', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
    app = buildTestApp({ db });
  });

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  function api(
    owner: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) {
    return app.inject({
      method,
      url: `/api/links${path}`,
      cookies: { [OWNER_COOKIE]: owner },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  async function create(owner: string, payload: object): Promise<LinkDto> {
    const res = await api(owner, 'POST', '', payload);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<LinkDto>();
  }

  describe('POST /api/links', () => {
    it('creates a link with a Sqids code from the reserved id', async () => {
      const link = await create(ALICE, { url: 'https://Example.com/a b?x=1' });
      expect(link).toEqual({
        id: 1,
        code: encodeId(1),
        shortUrl: `${TEST_BASE_URL}/${encodeId(1)}`,
        targetUrl: 'https://example.com/a%20b?x=1',
        qrUrl: '/api/links/1/qr',
        expiresAt: null,
        maxClicks: null,
        isActive: true,
        createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        clickCount: 0,
        qrScanCount: 0,
        status: 'active',
      });
      expect(link.code).toMatch(/^[0-9a-z]{6,}$/);

      const { rows } = await db.query('SELECT owner_token, is_custom_alias FROM links');
      expect(rows).toEqual([{ owner_token: ALICE, is_custom_alias: false }]);
    });

    it('issues a pl_owner cookie on first use and scopes the link to it', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/links',
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(201);
      const owner = res.cookies.find((c) => c.name === OWNER_COOKIE)?.value ?? '';
      const { rows } = await db.query<{ owner_token: string }>('SELECT owner_token FROM links');
      expect(rows[0]?.owner_token).toBe(owner);
    });

    it('stores expiresAt and maxClicks', async () => {
      const link = await create(ALICE, {
        url: 'https://example.com',
        expiresAt: '2099-01-01T07:00:00+07:00',
        maxClicks: 5,
      });
      expect(link).toMatchObject({ expiresAt: '2099-01-01T00:00:00.000Z', maxClicks: 5 });
    });

    it('treats empty optional fields from forms as not given', async () => {
      const link = await create(ALICE, {
        url: 'https://example.com',
        alias: '',
        expiresAt: null,
        maxClicks: null,
      });
      expect(link).toMatchObject({ code: encodeId(1), expiresAt: null, maxClicks: null });
    });

    it('accepts a Thai alias, normalised to NFC, and builds a percent-encoded short URL', async () => {
      // "กาแฟ" is already NFC; "Coffee-01" is lowercased.
      const thai = await create(ALICE, { url: 'https://example.com', alias: 'กาแฟ' });
      expect(thai).toMatchObject({
        code: 'กาแฟ',
        shortUrl: `${TEST_BASE_URL}/${encodeURIComponent('กาแฟ')}`,
      });
      const latin = await create(ALICE, { url: 'https://example.com', alias: ' Coffee-01 ' });
      expect(latin.code).toBe('coffee-01');

      const { rows } = await db.query('SELECT is_custom_alias FROM links ORDER BY id');
      expect(rows).toEqual([{ is_custom_alias: true }, { is_custom_alias: true }]);
    });

    it('rejects a duplicate alias with 409, including case and NFC variants, across owners', async () => {
      await create(ALICE, { url: 'https://example.com', alias: 'coffee' });
      await create(ALICE, { url: 'https://example.com', alias: 'ก้า' });

      for (const alias of ['coffee', 'COFFEE', 'ก้า'.normalize('NFD')]) {
        const res = await api(BOB, 'POST', '', { url: 'https://example.com', alias });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({
          error: { code: 'ALIAS_TAKEN', message: expect.stringMatching(/ถูกใช้แล้ว/) },
        });
      }
    });

    it('skips a generated code that an alias already took', async () => {
      // The alias row takes id 1; the next reserved id (2) encodes to the alias, so id 3 is used.
      await create(ALICE, { url: 'https://example.com', alias: encodeId(2) });
      const link = await create(ALICE, { url: 'https://example.com' });
      expect(link).toMatchObject({ id: 3, code: encodeId(3) });
    });
  });

  describe('GET /api/links', () => {
    it('lists only the caller’s links, newest first, with cursor pagination', async () => {
      for (let i = 1; i <= 5; i++) await create(ALICE, { url: `https://example.com/${i}` });
      await create(BOB, { url: 'https://example.com/bob' });

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
        const res = await api(ALICE, 'GET', query);
        expect(res.statusCode).toBe(200);
        const body = res.json<{ items: LinkDto[]; nextCursor: string | null }>();
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items.map((l) => l.targetUrl));
        cursor = body.nextCursor;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual([5, 4, 3, 2, 1].map((i) => `https://example.com/${i}`));
    });

    it('breaks created_at ties by id so no row is skipped or repeated', async () => {
      // One statement → identical now() for every row.
      await db.query(
        `INSERT INTO links (owner_token, code, target_url)
         SELECT $1, 'tie' || g, 'https://example.com/' || g FROM generate_series(1, 5) g`,
        [ALICE],
      );
      const ids: number[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
        const body = (await api(ALICE, 'GET', query)).json<{
          items: LinkDto[];
          nextCursor: string | null;
        }>();
        ids.push(...body.items.map((l) => l.id));
        cursor = body.nextCursor;
      } while (cursor);
      expect(ids).toEqual([5, 4, 3, 2, 1]);
    });

    it('defaults to 20 items and returns an empty page for a new owner', async () => {
      const empty = await api(BOB, 'GET', '');
      expect(empty.json()).toEqual({ items: [], nextCursor: null });

      await db.query(
        `INSERT INTO links (owner_token, code, target_url)
         SELECT $1, 'bulk' || g, 'https://example.com' FROM generate_series(1, 21) g`,
        [ALICE],
      );
      const body = (await api(ALICE, 'GET', '')).json<{ items: unknown[]; nextCursor: unknown }>();
      expect(body.items).toHaveLength(20);
      expect(body.nextCursor).toEqual(expect.any(String));
    });

    it('reports clicks and QR scans separately, excluding bots', async () => {
      const link = await create(ALICE, { url: 'https://example.com' });
      // 3 plain clicks + 2 QR scans by people, plus bot traffic of both kinds.
      await db.query(
        `INSERT INTO clicks (link_id, source, is_bot) VALUES
           ($1,'click',false),($1,'click',false),($1,'click',false),
           ($1,'qr',false),($1,'qr',false),($1,'qr',true),($1,'click',true)`,
        [link.id],
      );
      await db.query('UPDATE links SET click_count = 5 WHERE id = $1', [link.id]);

      const [item] = (await api(ALICE, 'GET', '')).json<{ items: LinkDto[] }>().items;
      expect(item).toMatchObject({ clickCount: 3, qrScanCount: 2 });
      expect((await api(ALICE, 'GET', `/${link.id}`)).json()).toMatchObject({
        clickCount: 3,
        qrScanCount: 2,
      });
    });

    it('derives status: disabled > expired > exhausted > active', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 4; i++)
        ids.push((await create(ALICE, { url: 'https://example.com' })).id);
      await db.query(
        `UPDATE links SET
           is_active = (id <> $1),
           expires_at = CASE WHEN id IN ($1, $2) THEN now() - interval '1 minute' END,
           max_clicks = CASE WHEN id IN ($1, $2, $3) THEN 1 END,
           click_count = CASE WHEN id IN ($1, $2, $3) THEN 1 ELSE 0 END`,
        ids.slice(0, 3),
      );
      const items = (await api(ALICE, 'GET', '')).json<{ items: LinkDto[] }>().items;
      const statusById = Object.fromEntries(items.map((l) => [l.id, l.status]));
      expect(ids.map((id) => statusById[id])).toEqual([
        'disabled',
        'expired',
        'exhausted',
        'active',
      ]);
    });
  });

  describe('GET/PATCH/DELETE /api/links/:id ownership', () => {
    it('returns 404 for another owner’s link and for missing ids', async () => {
      const link = await create(ALICE, { url: 'https://example.com' });
      expect((await api(ALICE, 'GET', `/${link.id}`)).json()).toMatchObject({ id: link.id });

      for (const [method, payload] of [
        ['GET', undefined],
        ['PATCH', { isActive: false }],
        ['DELETE', undefined],
      ] as const) {
        const res = await api(BOB, method, `/${link.id}`, payload);
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ error: { code: 'LINK_NOT_FOUND' } });
      }
      expect((await api(ALICE, 'GET', '/999')).statusCode).toBe(404);

      // Bob's attempts changed nothing.
      const { rows } = await db.query('SELECT is_active FROM links');
      expect(rows).toEqual([{ is_active: true }]);
    });
  });

  describe('PATCH /api/links/:id', () => {
    it('updates isActive, expiresAt and maxClicks, and null clears limits', async () => {
      const link = await create(ALICE, { url: 'https://example.com', maxClicks: 3 });

      const disabled = await api(ALICE, 'PATCH', `/${link.id}`, { isActive: false });
      expect(disabled.json()).toMatchObject({ isActive: false, status: 'disabled', maxClicks: 3 });

      const changed = await api(ALICE, 'PATCH', `/${link.id}`, {
        isActive: true,
        expiresAt: '2099-06-01T00:00:00Z',
        maxClicks: null,
      });
      expect(changed.json()).toMatchObject({
        isActive: true,
        status: 'active',
        expiresAt: '2099-06-01T00:00:00.000Z',
        maxClicks: null,
        targetUrl: 'https://example.com/',
      });

      const cleared = await api(ALICE, 'PATCH', `/${link.id}`, { expiresAt: null });
      expect(cleared.json()).toMatchObject({ expiresAt: null });
    });

    it('rejects an expiry in the past', async () => {
      const link = await create(ALICE, { url: 'https://example.com' });
      const res = await api(ALICE, 'PATCH', `/${link.id}`, { expiresAt: '2001-01-01T00:00:00Z' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });
  });

  describe('DELETE /api/links/:id', () => {
    it('deletes the link and its clicks', async () => {
      const link = await create(ALICE, { url: 'https://example.com' });
      await db.query(`INSERT INTO clicks (link_id) VALUES ($1)`, [link.id]);

      const res = await api(ALICE, 'DELETE', `/${link.id}`);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect((await api(ALICE, 'GET', `/${link.id}`)).statusCode).toBe(404);
      expect((await db.query('SELECT 1 FROM clicks')).rowCount).toBe(0);
      expect((await api(ALICE, 'DELETE', `/${link.id}`)).statusCode).toBe(404);
    });
  });
});
