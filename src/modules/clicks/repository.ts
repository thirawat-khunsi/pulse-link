import type { Db } from '../../shared/db.js';
import type { ClickRow, ClickWriter } from './buffer.js';

/**
 * Writes a batch in one statement (so it is atomic):
 * - INSERT clicks, joined to links so rows of links deleted before the flush are dropped (D-008)
 * - click_count += n for non-bot visits not already counted by the atomic max_clicks UPDATE
 */
const FLUSH_SQL = `
WITH input AS (
  SELECT * FROM unnest(
    $1::bigint[], $2::timestamptz[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
    $8::boolean[], $9::boolean[]
  ) AS u(link_id, clicked_at, source, device, browser, os, referrer_host, is_bot, counted)
), inserted AS (
  INSERT INTO clicks (link_id, clicked_at, source, device, browser, os, referrer_host, is_bot)
  SELECT i.link_id, i.clicked_at, i.source, i.device, i.browser, i.os, i.referrer_host, i.is_bot
    FROM input i JOIN links l ON l.id = i.link_id
)
UPDATE links SET click_count = links.click_count + d.n
  FROM (SELECT link_id, COUNT(*)::int AS n FROM input
         WHERE NOT is_bot AND NOT counted GROUP BY link_id) d
 WHERE links.id = d.link_id`;

export function createClickWriter(db: Db): ClickWriter {
  return {
    async write(rows: ClickRow[]): Promise<void> {
      if (rows.length === 0) return;
      await db.query(FLUSH_SQL, [
        rows.map((r) => r.linkId),
        rows.map((r) => r.clickedAt),
        rows.map((r) => r.source),
        rows.map((r) => r.device),
        rows.map((r) => r.browser),
        rows.map((r) => r.os),
        rows.map((r) => r.referrerHost),
        rows.map((r) => r.isBot),
        rows.map((r) => r.counted),
      ]);
    },
  };
}
