import type { Db } from '../../shared/db.js';

export interface RedirectRow {
  id: string; // BIGINT
  target_url: string;
  is_active: boolean;
  expires_at: Date | null;
  max_clicks: number | null;
  click_count: number;
}

const COLUMNS = 'id, target_url, is_active, expires_at, max_clicks, click_count';

export function createRedirectRepository(db: Db) {
  return {
    async findByCode(code: string): Promise<RedirectRow | null> {
      const { rows } = await db.query<RedirectRow>(`SELECT ${COLUMNS} FROM links WHERE code = $1`, [
        code,
      ]);
      return rows[0] ?? null;
    },

    async findById(id: number): Promise<RedirectRow | null> {
      const { rows } = await db.query<RedirectRow>(`SELECT ${COLUMNS} FROM links WHERE id = $1`, [
        id,
      ]);
      return rows[0] ?? null;
    },

    /**
     * SPEC §4: the single atomic statement that both checks and consumes one max_clicks visit.
     * Row locking serialises concurrent visitors; expiry is re-checked here too (DECISIONS D-004).
     * Returns null when the link is disabled, expired, exhausted or gone.
     */
    async consumeVisit(id: number): Promise<string | null> {
      const { rows } = await db.query<{ target_url: string }>(
        `UPDATE links SET click_count = click_count + 1
          WHERE id = $1 AND is_active
            AND (expires_at IS NULL OR expires_at > now())
            AND (max_clicks IS NULL OR click_count < max_clicks)
          RETURNING target_url`,
        [id],
      );
      return rows[0]?.target_url ?? null;
    },
  };
}

export type RedirectRepository = ReturnType<typeof createRedirectRepository>;
