import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClickBuffer } from '../../src/modules/clicks/buffer.js';
import { createClickWriter } from '../../src/modules/clicks/repository.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { OWNER_COOKIE } from '../../src/shared/owner.js';
import { buildTestApp, TEST_BASE_URL } from '../helpers/app.js';
import { decodeQrPng } from '../helpers/qr.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const COFFEE = 'กาแฟ';
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe.skipIf(!url)('GET /api/links/:id/qr (requires TEST_DATABASE_URL)', () => {
  let db: Db;
  let app: FastifyInstance;
  let buffer: ClickBuffer;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
    buffer = new ClickBuffer({ writer: createClickWriter(db), flushIntervalMs: 60_000 });
    app = buildTestApp({ db, clicks: buffer });
  });

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  async function insertLink(code: string, owner = ALICE): Promise<number> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO links (owner_token, code, target_url) VALUES ($1, $2, 'https://example.com/') RETURNING id`,
      [owner, code],
    );
    return Number(rows[0]?.id);
  }

  const qr = (id: number, query = '', owner = ALICE) =>
    app.inject({
      method: 'GET',
      url: `/api/links/${id}/qr${query}`,
      cookies: { [OWNER_COOKIE]: owner },
    });

  it('returns a 512px PNG by default that decodes to BASE_URL/code?s=qr', async () => {
    const id = await insertLink('abc123');
    const res = await qr(id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(decodeQrPng(res.rawPayload)).toEqual({
      text: `${TEST_BASE_URL}/abc123?s=qr`,
      width: 512,
      height: 512,
    });
  });

  it('encodes a Thai alias percent-encoded and honours size', async () => {
    const id = await insertLink(COFFEE);
    const res = await qr(id, '?size=300');
    expect(decodeQrPng(res.rawPayload)).toEqual({
      text: `${TEST_BASE_URL}/${encodeURIComponent(COFFEE)}?s=qr`,
      width: 300,
      height: 300,
    });
  });

  it('returns the same QR as SVG (M, margin 2), inert under CSP', async () => {
    const id = await insertLink('abc123');
    const res = await qr(id, '?format=svg&size=256');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    const expected = await QRCode.toString(`${TEST_BASE_URL}/abc123?s=qr`, {
      type: 'svg',
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    expect(res.body).toBe(expected);
  });

  it.each([
    ['png', 'abc123', `filename*=UTF-8''pulse-link-abc123.png`],
    ['svg', COFFEE, `filename*=UTF-8''pulse-link-${encodeURIComponent(COFFEE)}.svg`],
  ])('download=1 (%s) sends an attachment named after the code', async (format, code, utf8) => {
    const id = await insertLink(code);
    const res = await qr(id, `?format=${format}&download=1`);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="pulse-link-${id}.${format}"; ${utf8}`,
    );
  });

  it('another owner’s link and a missing id are 404', async () => {
    const id = await insertLink('abc123');
    for (const res of [await qr(id, '', BOB), await qr(999)]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'LINK_NOT_FOUND' } });
    }
  });

  it('scanning the downloaded QR opens the target and is counted as a scan (SPEC §10.2)', async () => {
    const id = await insertLink(COFFEE);
    const { text } = decodeQrPng((await qr(id, '?download=1')).rawPayload);
    expect(text).not.toBeNull();

    // What a phone does with the decoded URL: open it.
    const scanned = new URL(text ?? '');
    expect(scanned.origin).toBe(TEST_BASE_URL);
    const res = await app.inject({
      method: 'GET',
      url: scanned.pathname + scanned.search,
      headers: { 'user-agent': PHONE },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/');

    await buffer.flush();
    const { rows } = await db.query('SELECT source, is_bot FROM clicks');
    expect(rows).toEqual([{ source: 'qr', is_bot: false }]);
    const links = await app.inject({
      method: 'GET',
      url: `/api/links/${id}`,
      cookies: { [OWNER_COOKIE]: ALICE },
    });
    expect(links.json()).toMatchObject({ clickCount: 0, qrScanCount: 1 });
  });
});
