import type { Db } from '../../shared/db.js';

export const STATS_TIME_ZONE = 'Asia/Bangkok';
const RECENT_LIMIT = 20;
const TOP_REFERRERS = 10;

/*
 * Every query takes $1 = link id, $2 = "now" (from the caller, so tests can pin it), $3 = days.
 * Days are calendar days in Asia/Bangkok: the range is [start of (today - days + 1), start of
 * tomorrow) in that zone, written as timestamptz bounds so idx_clicks_link_time is used.
 * Only non-bot rows are counted (D-018); bots appear only in totals.bots.
 */
const TODAY = `(($2::timestamptz AT TIME ZONE '${STATS_TIME_ZONE}')::date)`;
const RANGE_START = `((${TODAY} - ($3::int - 1))::timestamp AT TIME ZONE '${STATS_TIME_ZONE}')`;
const RANGE_END = `((${TODAY} + 1)::timestamp AT TIME ZONE '${STATS_TIME_ZONE}')`;
const IN_RANGE = `link_id = $1 AND NOT is_bot AND clicked_at >= ${RANGE_START} AND clicked_at < ${RANGE_END}`;

export interface TotalsRow {
  clicks: string;
  qr_scans: string;
  bots: string;
}
export interface DayRow {
  day: string;
  clicks: string;
  qr_scans: string;
}
export interface CountRow {
  key: string | null;
  count: string;
}
export interface RecentRow {
  clicked_at: Date;
  source: 'click' | 'qr';
  device: string | null;
  browser: string | null;
  os: string | null;
  referrer_host: string | null;
}

export function createStatsRepository(db: Db) {
  const params = (linkId: number, now: Date, days: number) => [linkId, now, days];

  async function countBy(
    column: 'device' | 'browser' | 'referrer_host',
    linkId: number,
    now: Date,
    days: number,
    limit?: number,
  ) {
    const { rows } = await db.query<CountRow>(
      `SELECT ${column} AS key, COUNT(*) AS count FROM clicks
        WHERE ${IN_RANGE}
        GROUP BY ${column}
        ORDER BY count DESC, ${column} NULLS LAST
        ${limit ? `LIMIT ${limit}` : ''}`,
      params(linkId, now, days),
    );
    return rows;
  }

  return {
    /** All-time totals (user decision): match clickCount/qrScanCount of the links API. */
    async totals(linkId: number): Promise<TotalsRow> {
      const { rows } = await db.query<TotalsRow>(
        `SELECT COUNT(*) FILTER (WHERE source = 'click' AND NOT is_bot) AS clicks,
                COUNT(*) FILTER (WHERE source = 'qr' AND NOT is_bot) AS qr_scans,
                COUNT(*) FILTER (WHERE is_bot) AS bots
           FROM clicks WHERE link_id = $1`,
        [linkId],
      );
      return rows[0] ?? { clicks: '0', qr_scans: '0', bots: '0' };
    },

    /** One row per Bangkok calendar day in the range, oldest first; empty days are 0. */
    async byDay(linkId: number, now: Date, days: number): Promise<DayRow[]> {
      const { rows } = await db.query<DayRow>(
        `WITH days AS (
           SELECT generate_series(${TODAY} - ($3::int - 1), ${TODAY}, interval '1 day')::date AS day
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                COUNT(c.id) FILTER (WHERE c.source = 'click') AS clicks,
                COUNT(c.id) FILTER (WHERE c.source = 'qr') AS qr_scans
           FROM days d
           LEFT JOIN clicks c
             ON c.link_id = $1 AND NOT c.is_bot
            AND c.clicked_at >= (d.day::timestamp AT TIME ZONE '${STATS_TIME_ZONE}')
            AND c.clicked_at < ((d.day + 1)::timestamp AT TIME ZONE '${STATS_TIME_ZONE}')
          GROUP BY d.day
          ORDER BY d.day`,
        params(linkId, now, days),
      );
      return rows;
    },

    byDevice: (linkId: number, now: Date, days: number) => countBy('device', linkId, now, days),
    byBrowser: (linkId: number, now: Date, days: number) => countBy('browser', linkId, now, days),
    byReferrer: (linkId: number, now: Date, days: number) =>
      countBy('referrer_host', linkId, now, days, TOP_REFERRERS),

    /** Latest non-bot visits regardless of the selected range. */
    async recent(linkId: number): Promise<RecentRow[]> {
      const { rows } = await db.query<RecentRow>(
        `SELECT clicked_at, source, device, browser, os, referrer_host FROM clicks
          WHERE link_id = $1 AND NOT is_bot
          ORDER BY clicked_at DESC, id DESC
          LIMIT ${RECENT_LIMIT}`,
        [linkId],
      );
      return rows;
    },
  };
}

export type StatsRepository = ReturnType<typeof createStatsRepository>;
