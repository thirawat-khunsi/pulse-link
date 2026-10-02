import { describe, expect, it } from 'vitest';
import { statsQuery } from '../../src/modules/stats/routes.js';
import { buildTestApp, unusedPool } from '../helpers/app.js';

describe('stats query', () => {
  it.each([
    [{}, 7],
    [{ days: '7' }, 7],
    [{ days: '30' }, 30],
  ])('%o → days=%i', (query, days) => {
    expect(statsQuery.parse(query)).toEqual({ days });
  });

  it.each(['1', '14', '31', 'abc', '7.0'])('days=%s → 400 VALIDATION_ERROR', async (days) => {
    const app = buildTestApp({ db: unusedPool() });
    const res = await app.inject({ method: 'GET', url: `/api/links/1/stats?days=${days}` });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'days ต้องเป็น 7 หรือ 30' },
    });
  });
});
