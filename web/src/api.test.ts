import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, NETWORK_ERROR_MESSAGE, qrImageUrl } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('sends JSON with same-origin credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(json(201, { id: 1 })));
    const api = createApi(fetchImpl);
    await expect(api.createLink({ url: 'https://example.com' })).resolves.toEqual({ id: 1 });
    expect(fetchImpl).toHaveBeenCalledWith('/api/links', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"url":"https://example.com"}',
    });
  });

  it('builds list and stats query strings', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(json(200, {})));
    const api = createApi(fetchImpl);
    await api.listLinks('abc', 20);
    await api.listLinks();
    await api.getStats(3, 30);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      '/api/links?limit=20&cursor=abc',
      '/api/links?limit=20',
      '/api/links/3/stats?days=30',
    ]);
  });

  it('returns undefined for 204', async () => {
    const api = createApi(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(api.deleteLink(1)).resolves.toBeUndefined();
  });

  it('surfaces the server Thai error message', async () => {
    const api = createApi(() =>
      Promise.resolve(
        json(409, { error: { code: 'ALIAS_TAKEN', message: 'ชื่อลิงก์นี้ถูกใช้แล้ว' } }),
      ),
    );
    const err = await api.createLink({ url: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      code: 'ALIAS_TAKEN',
      message: 'ชื่อลิงก์นี้ถูกใช้แล้ว',
    });
  });

  it('falls back to a generic Thai message for non-JSON errors', async () => {
    const api = createApi(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })));
    await expect(api.getLink(1)).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('maps network failures to a Thai message', async () => {
    const api = createApi(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.getLink(1)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: NETWORK_ERROR_MESSAGE,
    });
  });
});

describe('qrImageUrl', () => {
  const link = { qrUrl: '/api/links/5/qr' };
  it('defaults to PNG', () => {
    expect(qrImageUrl(link)).toBe('/api/links/5/qr?format=png');
  });
  it('adds size and download', () => {
    expect(qrImageUrl(link, { format: 'svg', size: 1024, download: true })).toBe(
      '/api/links/5/qr?format=svg&size=1024&download=1',
    );
  });
});
