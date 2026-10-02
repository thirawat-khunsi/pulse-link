import { describe, expect, it } from 'vitest';
import { buildApp, servesApi, servesRedirect } from '../../src/app.js';
import { APP_MODES } from '../../src/shared/config.js';

describe('buildApp', () => {
  it.each(APP_MODES)('GET /health reports mode=%s', async (mode) => {
    const app = buildApp({ mode });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, mode });
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
