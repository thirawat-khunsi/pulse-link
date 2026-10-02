import { describe, expect, it } from 'vitest';
import { servesApi, servesRedirect } from '../../src/app.js';
import { APP_MODES } from '../../src/shared/config.js';
import { buildTestApp, unusedPool } from '../helpers/app.js';

describe('buildApp', () => {
  it.each(APP_MODES)('GET /health reports mode=%s', async (mode) => {
    const app = buildTestApp({ mode, db: unusedPool() });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, mode });
    await app.close();
  });

  it.each(['all', 'api'] as const)('mode=%s serves /api', async (mode) => {
    const app = buildTestApp({ mode, db: unusedPool() });
    const res = await app.inject({ method: 'POST', url: '/api/links', payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('mode=redirect does not serve /api', async () => {
    const app = buildTestApp({ mode: 'redirect', db: unusedPool() });
    const res = await app.inject({ method: 'POST', url: '/api/links', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    await app.close();
  });

  it('maps modes to the route groups they serve', () => {
    expect(APP_MODES.map((m) => [m, servesApi(m), servesRedirect(m)])).toEqual([
      ['all', true, true],
      ['api', true, false],
      ['redirect', false, true],
    ]);
  });
});
