import type { Db } from '../../shared/db.js';

/** A `links` row plus visit counts derived from `clicks`. */
export interface LinkRow {
  id: string; // BIGINT arrives as a string from pg
  owner_token: string;
  code: string;
  is_custom_alias: boolean;
  target_url: string;
  expires_at: Date | null;
  max_clicks: number | null;
  click_count: number;
  is_active: boolean;
  created_at: Date;
  /** `created_at::text` keeps microseconds, which a JS Date would lose (used for cursors). */
  created_at_text: string;
  // COUNT(*) is BIGINT, so both arrive as strings.
  click_total: string;
  qr_scan_count: string;
}

export interface NewLink {
  /** Pre-reserved id for generated codes; omitted for aliases (sequence default). */
  id?: number;
  ownerToken: string;
  code: string;
  isCustomAlias: boolean;
  targetUrl: string;
  expiresAt: Date | null;
  maxClicks: number | null;
}

export interface LinkPatch {
  isActive?: boolean;
  expiresAt?: Date | null;
  maxClicks?: number | null;
}

export interface ListCursor {
  createdAt: string;
  id: number;
}

// Displayed counts come from `clicks` (non-bot only), never from links.click_count, which exists
// to enforce max_clicks (DECISIONS D-018). Served by idx_clicks_link_time (link_id prefix).
const visits = (source: 'click' | 'qr', alias: string) =>
  `(SELECT COUNT(*) FROM clicks c
     WHERE c.link_id = l.id AND c.source = '${source}' AND NOT c.is_bot) AS ${alias}`;
const COLUMNS = `l.*, l.created_at::text AS created_at_text,
  ${visits('click', 'click_total')}, ${visits('qr', 'qr_scan_count')}`;

const PATCH_COLUMNS = {
  isActive: 'is_active',
  expiresAt: 'expires_at',
  maxClicks: 'max_clicks',
} as const satisfies Record<keyof LinkPatch, string>;

export function createLinkRepository(db: Db) {
  return {
    /** Reserve the next `links.id` so its Sqids code can be inserted together with it. */
    async reserveId(): Promise<number> {
      const { rows } = await db.query<{ id: string }>("SELECT nextval('links_id_seq') AS id");
      return Number(rows[0]?.id);
    },

    async insert(link: NewLink): Promise<LinkRow> {
      const { rows } = await db.query<LinkRow>(
        `WITH l AS (
           INSERT INTO links (id, owner_token, code, is_custom_alias, target_url, expires_at, max_clicks)
           VALUES (COALESCE($1, nextval('links_id_seq')), $2, $3, $4, $5, $6, $7)
           RETURNING *
         )
         SELECT l.*, l.created_at::text AS created_at_text, '0' AS click_total, '0' AS qr_scan_count FROM l`,
        [
          link.id ?? null,
          link.ownerToken,
          link.code,
          link.isCustomAlias,
          link.targetUrl,
          link.expiresAt,
          link.maxClicks,
        ],
      );
      return rows[0] as LinkRow;
    },

    /** Owner's links, newest first, keyset-paginated on (created_at, id). Fetches `limit` rows. */
    async listByOwner(
      ownerToken: string,
      limit: number,
      cursor: ListCursor | null,
    ): Promise<LinkRow[]> {
      const params: unknown[] = [ownerToken, limit];
      let after = '';
      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        after = 'AND (l.created_at, l.id) < ($3::timestamptz, $4)';
      }
      const { rows } = await db.query<LinkRow>(
        `SELECT ${COLUMNS} FROM links l
          WHERE l.owner_token = $1 ${after}
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT $2`,
        params,
      );
      return rows;
    },

    async findForOwner(id: number, ownerToken: string): Promise<LinkRow | null> {
      const { rows } = await db.query<LinkRow>(
        `SELECT ${COLUMNS} FROM links l WHERE l.id = $1 AND l.owner_token = $2`,
        [id, ownerToken],
      );
      return rows[0] ?? null;
    },

    async updateForOwner(
      id: number,
      ownerToken: string,
      patch: LinkPatch,
    ): Promise<LinkRow | null> {
      const sets: string[] = [];
      const params: unknown[] = [id, ownerToken];
      for (const key of Object.keys(PATCH_COLUMNS) as (keyof LinkPatch)[]) {
        if (patch[key] === undefined) continue;
        params.push(patch[key]);
        sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
      }
      if (sets.length === 0) return this.findForOwner(id, ownerToken);

      const { rows } = await db.query<LinkRow>(
        `WITH l AS (
           UPDATE links SET ${sets.join(', ')} WHERE id = $1 AND owner_token = $2 RETURNING *
         )
         SELECT ${COLUMNS} FROM l`,
        params,
      );
      return rows[0] ?? null;
    },

    /** Returns the deleted link's code (for cache invalidation), or null if not found. */
    async deleteForOwner(id: number, ownerToken: string): Promise<string | null> {
      const { rows } = await db.query<{ code: string }>(
        'DELETE FROM links WHERE id = $1 AND owner_token = $2 RETURNING code',
        [id, ownerToken],
      );
      return rows[0]?.code ?? null;
    },
  };
}

export type LinkRepository = ReturnType<typeof createLinkRepository>;
