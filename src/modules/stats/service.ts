import { type StatsRepository, STATS_TIME_ZONE } from './repository.js';

export type StatsDays = 7 | 30;

export interface LinkStats {
  days: StatsDays;
  timeZone: typeof STATS_TIME_ZONE;
  /** All time, non-bot clicks and scans exactly as clickCount/qrScanCount in the links API (D-018). */
  totals: { clicks: number; qrScans: number; bots: number };
  /** Every Bangkok calendar day in the range, oldest first. */
  byDay: { day: string; clicks: number; qrScans: number }[];
  byDevice: { device: string | null; count: number }[];
  byBrowser: { browser: string | null; count: number }[];
  /** Top 10; `host: null` means no Referer (opened directly, apps, QR scanners). */
  byReferrer: { host: string | null; count: number }[];
  /** Latest 20 non-bot visits, newest first, regardless of the range. */
  recent: {
    clickedAt: string;
    source: 'click' | 'qr';
    device: string | null;
    browser: string | null;
    os: string | null;
    referrerHost: string | null;
  }[];
}

export function createStatsService(repo: StatsRepository) {
  return {
    async forLink(linkId: number, days: StatsDays, now = new Date()): Promise<LinkStats> {
      const [totals, byDay, byDevice, byBrowser, byReferrer, recent] = await Promise.all([
        repo.totals(linkId),
        repo.byDay(linkId, now, days),
        repo.byDevice(linkId, now, days),
        repo.byBrowser(linkId, now, days),
        repo.byReferrer(linkId, now, days),
        repo.recent(linkId),
      ]);
      return {
        days,
        timeZone: STATS_TIME_ZONE,
        totals: {
          clicks: Number(totals.clicks),
          qrScans: Number(totals.qr_scans),
          bots: Number(totals.bots),
        },
        byDay: byDay.map((d) => ({
          day: d.day,
          clicks: Number(d.clicks),
          qrScans: Number(d.qr_scans),
        })),
        byDevice: byDevice.map((r) => ({ device: r.key, count: Number(r.count) })),
        byBrowser: byBrowser.map((r) => ({ browser: r.key, count: Number(r.count) })),
        byReferrer: byReferrer.map((r) => ({ host: r.key, count: Number(r.count) })),
        recent: recent.map((r) => ({
          clickedAt: r.clicked_at.toISOString(),
          source: r.source,
          device: r.device,
          browser: r.browser,
          os: r.os,
          referrerHost: r.referrer_host,
        })),
      };
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
