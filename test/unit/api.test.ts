import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_COOKIE } from '../../src/shared/owner.js';
import { buildTestApp, unusedPool } from '../helpers/app.js';

// Everything here is rejected before the database is touched.
describe('/api plumbing (no database)', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildTestApp({ db: unusedPool() });
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/links',
      headers: { 'content-type': 'application/json', ...headers },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

  describe('pl_owner cookie', () => {
    it('issues an httpOnly, SameSite=Lax UUID cookie valid for a year', async () => {
      const res = await post({});
      const cookie = res.cookies.find((c) => c.name === OWNER_COOKIE);
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 31_536_000,
      });
      expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
      expect(cookie?.secure).toBeUndefined();
    });

    it('keeps a valid cookie and replaces a malformed one', async () => {
      const valid = '0d6c3a4e-8f0b-4b7e-9a51-3f2a1c7d9e10';
      const kept = await post({}, { cookie: `${OWNER_COOKIE}=${valid}` });
      expect(kept.cookies.find((c) => c.name === OWNER_COOKIE)).toBeUndefined();

      const replaced = await post({}, { cookie: `${OWNER_COOKIE}=not-a-uuid` });
      expect(replaced.cookies.find((c) => c.name === OWNER_COOKIE)?.value).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    });

    it('is Secure when secureCookies is on', async () => {
      await app.close();
      app = buildTestApp({ db: unusedPool(), secureCookies: true });
      const res = await post({});
      expect(res.cookies.find((c) => c.name === OWNER_COOKIE)?.secure).toBe(true);
    });

    it('is not issued outside /api', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.cookies).toHaveLength(0);
    });
  });

  describe('error shape', () => {
    const expectError = (
      res: Awaited<ReturnType<typeof post>>,
      status: number,
      code: string,
      message?: string | RegExp,
    ) => {
      expect(res.statusCode).toBe(status);
      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body).toEqual({ error: { code, message: expect.any(String) } });
      // User-facing messages are Thai.
      expect(body.error.message).toMatch(/[฀-๿]/);
      if (message) expect(body.error.message).toMatch(message);
    };

    it('unknown /api route → 404 NOT_FOUND', async () => {
      expectError(await app.inject({ method: 'GET', url: '/api/nope' }), 404, 'NOT_FOUND');
    });

    it('malformed JSON → 400 INVALID_BODY', async () => {
      expectError(await post('{"url":'), 400, 'INVALID_BODY');
    });

    it('non-JSON content type → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/links',
        headers: { 'content-type': 'text/plain' },
        payload: 'https://example.com',
      });
      expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    });

    it.each([
      ['missing url', {}, 'URL ปลายทาง'],
      ['body is not an object', [], 'JSON object'],
      ['unknown field', { url: 'https://example.com', foo: 1 }, 'foo'],
      ['maxClicks 0', { url: 'https://example.com', maxClicks: 0 }, 'จำนวนคลิกสูงสุด'],
      ['maxClicks fraction', { url: 'https://example.com', maxClicks: 1.5 }, 'จำนวนคลิกสูงสุด'],
      ['maxClicks over INTEGER', { url: 'https://example.com', maxClicks: 2 ** 31 }, 'จำนวนคลิก'],
      [
        'expiresAt without zone',
        { url: 'https://example.com', expiresAt: '2030-01-01T00:00' },
        'เขตเวลา',
      ],
      [
        'expiresAt in the past',
        { url: 'https://example.com', expiresAt: '2000-01-01T00:00:00Z' },
        'อนาคต',
      ],
    ])('%s → 400 VALIDATION_ERROR', async (_name, body, message) => {
      expectError(await post(body), 400, 'VALIDATION_ERROR', message);
    });

    it.each([
      ['ftp://example.com', 'http'],
      ['example.com', 'รูปแบบ'],
      ['https://user:pass@example.com', 'รหัสผ่าน'],
      ['http://127.0.0.1/', 'ภายใน'],
      ['https://pl.test/abc', 'โดเมนของระบบ'],
    ])('url %s → 400 INVALID_URL', async (url, message) => {
      expectError(await post({ url }), 400, 'INVALID_URL', message);
    });

    it.each([
      ['ab', 'ยาว'],
      ['api', 'คำสงวน'],
      ['has space', 'ใช้ได้เฉพาะ'],
    ])('alias %s → 400 INVALID_ALIAS', async (alias, message) => {
      expectError(await post({ url: 'https://example.com', alias }), 400, 'INVALID_ALIAS', message);
    });

    it.each(['abc', '0', '-1', '1.5', '99999999999999999999'])(
      'non-numeric or out-of-range id %s → 404 LINK_NOT_FOUND',
      async (id) => {
        expectError(
          await app.inject({ method: 'GET', url: `/api/links/${id}` }),
          404,
          'LINK_NOT_FOUND',
        );
      },
    );

    it('PATCH cannot change the target URL', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/links/1',
        payload: { url: 'https://other.example.com' },
      });
      expectError(res, 400, 'TARGET_URL_IMMUTABLE');
    });

    it.each([
      ['empty patch', {}, 'ไม่มีข้อมูล'],
      ['isActive not boolean', { isActive: 'yes' }, 'true หรือ false'],
    ])('PATCH %s → 400 VALIDATION_ERROR', async (_name, payload, message) => {
      const res = await app.inject({ method: 'PATCH', url: '/api/links/1', payload });
      expectError(res, 400, 'VALIDATION_ERROR', message);
    });

    it.each([
      ['limit=0', 'limit'],
      ['limit=101', 'limit'],
      ['limit=abc', 'limit'],
      ['cursor=garbage', 'cursor'],
    ])('GET /api/links?%s → 400 VALIDATION_ERROR', async (query, message) => {
      const res = await app.inject({ method: 'GET', url: `/api/links?${query}` });
      expectError(res, 400, 'VALIDATION_ERROR', message);
    });
  });

  describe('rate limits', () => {
    it('POST /api/links allows 30 requests per minute per IP', async () => {
      for (let i = 0; i < 30; i++) expect((await post({})).statusCode).toBe(400);
      const limited = await post({});
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({
        error: { code: 'RATE_LIMITED', message: expect.stringMatching(/[฀-๿]/) },
      });
      // Another client is unaffected.
      const other = await app.inject({
        method: 'POST',
        url: '/api/links',
        remoteAddress: '203.0.113.9',
        payload: {},
      });
      expect(other.statusCode).toBe(400);
    });

    it('other /api routes allow 300 requests per minute per IP', async () => {
      const get = () => app.inject({ method: 'GET', url: '/api/links/abc' });
      for (let i = 0; i < 300; i++) expect((await get()).statusCode).toBe(404);
      expect((await get()).statusCode).toBe(429);
    });
  });

  it('sets helmet security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
