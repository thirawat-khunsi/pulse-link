import { describe, expect, it } from 'vitest';
import { contentDisposition, qrTarget, renderQr } from '../../src/modules/qr/service.js';
import { buildTestApp, unusedPool } from '../helpers/app.js';
import { decodeQrPng } from '../helpers/qr.js';

describe('qr service', () => {
  it('encodes the short URL marked as a scan, percent-encoding Thai codes', () => {
    expect(qrTarget('https://pl.test', 'abc123')).toBe('https://pl.test/abc123?s=qr');
    expect(qrTarget('https://pl.test', 'กาแฟ')).toBe(
      'https://pl.test/%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F?s=qr',
    );
  });

  it.each([128, 512, 2048])('renders a decodable %ipx PNG', async (size) => {
    const png = await renderQr('https://pl.test/abc123?s=qr', 'png', size);
    expect(decodeQrPng(png)).toEqual({
      text: 'https://pl.test/abc123?s=qr',
      width: size,
      height: size,
    });
  });

  it('renders an SVG', async () => {
    const svg = (await renderQr('https://pl.test/abc123?s=qr', 'svg', 256)).toString('utf8');
    expect(svg).toMatch(/^<svg [^>]*width="256"[^>]*>/);
    expect(svg).not.toMatch(/<script/i);
  });

  it('builds an attachment header with an ASCII fallback and an RFC 5987 UTF-8 name', () => {
    expect(contentDisposition(7, 'abc123', 'png')).toBe(
      `attachment; filename="pulse-link-7.png"; filename*=UTF-8''pulse-link-abc123.png`,
    );
    expect(contentDisposition(8, 'กาแฟ', 'svg')).toBe(
      `attachment; filename="pulse-link-8.svg"; filename*=UTF-8''pulse-link-%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F.svg`,
    );
  });
});

describe('GET /api/links/:id/qr validation (no database)', () => {
  it.each([
    ['format=gif', 'png หรือ svg'],
    ['size=127', '128-2048'],
    ['size=2049', '128-2048'],
    ['size=abc', '128-2048'],
    ['size=300.5', '128-2048'],
  ])('%s → 400 VALIDATION_ERROR', async (query, message) => {
    const app = buildTestApp({ db: unusedPool() });
    const res = await app.inject({ method: 'GET', url: `/api/links/1/qr?${query}` });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining(message) },
    });
  });

  it('a non-numeric id is 404 without a query', async () => {
    const app = buildTestApp({ db: unusedPool() });
    const res = await app.inject({ method: 'GET', url: '/api/links/abc/qr' });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'LINK_NOT_FOUND' } });
  });
});
