import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStatsRepository } from '../../src/modules/stats/repository.js';
import { createStatsService, type LinkStats } from '../../src/modules/stats/service.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { OWNER_COOKIE } from '../../src/shared/owner.js';
import { buildTestApp } from '../helpers/app.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
// 12:00 on 2 Oct 2026 in Bangkok (UTC+7).
const NOW = new Date('2026-10-02T05:00:00Z');

interface Click {
  at: string;
  source?: 'click' | 'qr';
  bot?: boolean;
  device?: string;
  browser?: string | null;
  os?: string | null;
  referrer?: string | null;
}

describe.skipIf(!url)('link stats (requires TEST_DATABASE_URL)', () => {
  let db: Db;
  let app: FastifyInstance;
  let linkId: number;
  const stats = (days: 7 | 30 = 7, now = NOW) =>
    createStatsService(createStatsRepository(db)).forLink(linkId, days, now);

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
    app = buildTestApp({ db });
  });

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO links (owner_token, code, target_url) VALUES ($1, 'stats1', 'https://example.com/') RETURNING id`,
      [ALICE],
    );
    linkId = Number(rows[0]?.id);
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  async function insertClicks(clicks: Click[]): Promise<void> {
    for (const c of clicks) {
      await db.query(
        `INSERT INTO clicks (link_id, clicked_at, source, is_bot, device, browser, os, referrer_host)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          linkId,
          c.at,
          c.source ?? 'click',
          c.bot ?? false,
          c.device ?? (c.bot ? 'bot' : 'mobile'),
          c.browser === undefined ? 'Chrome' : c.browser,
          c.os === undefined ? 'Android' : c.os,
          c.referrer ?? null,
        ],
      );
    }
  }

  const dayMap = (s: LinkStats) =>
    Object.fromEntries(s.byDay.map((d) => [d.day, [d.clicks, d.qrScans]]));

  describe('byDay', () => {
    it('lists every day of the range oldest first, with empty days as 0', async () => {
      const week = await stats(7);
      expect(week.byDay.map((d) => d.day)).toEqual([
        '2026-09-26',
        '2026-09-27',
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
      ]);
      expect(week.byDay.every((d) => d.clicks === 0 && d.qrScans === 0)).toBe(true);

      const month = await stats(30);
      expect(month.byDay).toHaveLength(30);
      expect(month.byDay[0]?.day).toBe('2026-09-03');
      expect(month.byDay.at(-1)?.day).toBe('2026-10-02');
    });

    it('groups by the Asia/Bangkok calendar day, not UTC', async () => {
      await insertClicks([
        { at: '2026-10-01T16:59:59Z' }, // 23:59:59 on 1 Oct in Bangkok
        { at: '2026-10-01T17:00:00Z' }, // 00:00:00 on 2 Oct in Bangkok (still 1 Oct in UTC)
        { at: '2026-10-01T23:30:00Z', source: 'qr' }, // 06:30 on 2 Oct
        { at: '2026-09-25T17:00:00Z' }, // 00:00 on 26 Sep in Bangkok: first day of the range
        { at: '2026-09-25T16:59:59Z' }, // 23:59:59 on 25 Sep: before the range
        { at: '2026-10-02T04:00:00Z', bot: true }, // bots never appear in byDay
      ]);
      const s = await stats(7);
      expect(dayMap(s)).toMatchObject({
        '2026-09-26': [1, 0],
        '2026-10-01': [1, 0],
        '2026-10-02': [1, 1],
      });
      expect(s.byDay.reduce((n, d) => n + d.clicks + d.qrScans, 0)).toBe(4);
    });

    it('moves the range with "now" in Bangkok, not UTC', async () => {
      // 23:30 UTC on 1 Oct is already 06:30 on 2 Oct in Bangkok.
      const s = await stats(7, new Date('2026-10-01T23:30:00Z'));
      expect(s.byDay.at(-1)?.day).toBe('2026-10-02');
    });
  });

  describe('totals (all time, D-018)', () => {
    it('counts non-bot clicks and scans separately, bots only in totals.bots, outside the range too', async () => {
      await insertClicks([
        { at: '2026-10-02T01:00:00Z' },
        { at: '2026-10-02T02:00:00Z' },
        { at: '2026-10-02T03:00:00Z', source: 'qr' },
        { at: '2026-10-02T03:30:00Z', bot: true },
        { at: '2026-10-02T03:40:00Z', bot: true, source: 'qr' },
        { at: '2025-01-01T00:00:00Z' }, // long before the range: still in all-time totals
      ]);
      const s = await stats(7);
      expect(s.totals).toEqual({ clicks: 3, qrScans: 1, bots: 2 });
      expect(s.byDay.reduce((n, d) => n + d.clicks, 0)).toBe(2);
    });
  });

  describe('breakdowns (range only, no bots)', () => {
    it('counts devices and browsers in the range, most common first, null kept', async () => {
      await insertClicks([
        { at: '2026-10-02T01:00:00Z', device: 'desktop', browser: 'Firefox' },
        { at: '2026-10-02T01:00:00Z', device: 'mobile', browser: 'Chrome' },
        { at: '2026-10-02T01:00:00Z', device: 'mobile', browser: 'Chrome' },
        { at: '2026-10-02T01:00:00Z', device: 'unknown', browser: null },
        { at: '2026-10-02T01:00:00Z', bot: true, browser: 'Chrome' },
        { at: '2026-09-10T01:00:00Z', device: 'tablet', browser: 'Safari' }, // in 30 days, not 7
      ]);
      const s = await stats(7);
      expect(s.byDevice).toEqual([
        { device: 'mobile', count: 2 },
        { device: 'desktop', count: 1 },
        { device: 'unknown', count: 1 },
      ]);
      expect(s.byBrowser).toEqual([
        { browser: 'Chrome', count: 2 },
        { browser: 'Firefox', count: 1 },
        { browser: null, count: 1 },
      ]);
      expect((await stats(30)).byDevice).toContainEqual({ device: 'tablet', count: 1 });
    });

    it('returns the top 10 referrers, including "no referrer" as null', async () => {
      const clicks: Click[] = [];
      // host-1 … host-12 with 12 … 1 visits, plus 5 visits without a referrer.
      for (let i = 1; i <= 12; i++) {
        for (let n = 0; n < 13 - i; n++) {
          clicks.push({ at: '2026-10-02T01:00:00Z', referrer: `host-${i}.example` });
        }
      }
      for (let n = 0; n < 5; n++) clicks.push({ at: '2026-10-02T01:00:00Z', referrer: null });
      await insertClicks(clicks);

      const { byReferrer } = await stats(7);
      expect(byReferrer).toHaveLength(10);
      expect(byReferrer.slice(0, 3)).toEqual([
        { host: 'host-1.example', count: 12 },
        { host: 'host-2.example', count: 11 },
        { host: 'host-3.example', count: 10 },
      ]);
      expect(byReferrer).toContainEqual({ host: null, count: 5 });
      // Ties sort named hosts before null; host-8 (5 visits) wins the tie with null.
      expect(byReferrer.at(-1)).toEqual({ host: 'host-9.example', count: 4 });
    });
  });

  describe('recent', () => {
    it('returns the latest 20 non-bot visits, newest first, regardless of range', async () => {
      const clicks: Click[] = [];
      for (let i = 0; i < 25; i++) {
        clicks.push({
          at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
          referrer: `r${i}.example`,
        });
      }
      clicks.push({ at: '2026-10-02T04:59:00Z', bot: true });
      await insertClicks(clicks);

      const { recent } = await stats(7);
      expect(recent).toHaveLength(20);
      expect(recent[0]).toEqual({
        clickedAt: '2026-01-01T00:24:00.000Z',
        source: 'click',
        device: 'mobile',
        browser: 'Chrome',
        os: 'Android',
        referrerHost: 'r24.example',
      });
      expect(recent.at(-1)?.referrerHost).toBe('r5.example');
      expect(recent.some((r) => r.device === 'bot')).toBe(false);
    });
  });

  describe('GET /api/links/:id/stats', () => {
    const get = (path: string, owner = ALICE) =>
      app.inject({ method: 'GET', url: path, cookies: { [OWNER_COOKIE]: owner } });

    it('returns the stats shape with no-store, 7 days by default', async () => {
      const res = await get(`/api/links/${linkId}/stats`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json<LinkStats>();
      expect(body).toMatchObject({
        days: 7,
        timeZone: 'Asia/Bangkok',
        totals: { clicks: 0, qrScans: 0, bots: 0 },
        byDevice: [],
        byBrowser: [],
        byReferrer: [],
        recent: [],
      });
      expect(body.byDay).toHaveLength(7);
      expect(
        (await get(`/api/links/${linkId}/stats?days=30`)).json<LinkStats>().byDay,
      ).toHaveLength(30);
    });

    it('is 404 for another owner and for a missing link', async () => {
      for (const res of [
        await get(`/api/links/${linkId}/stats`, BOB),
        await get('/api/links/999/stats'),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ error: { code: 'LINK_NOT_FOUND' } });
      }
    });
  });
});
