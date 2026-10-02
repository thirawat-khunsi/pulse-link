import { isReservedCode } from '../../shared/alias.js';
import type { CachedLink, LinkCache } from './cache.js';
import type { RedirectRepository, RedirectRow } from './repository.js';

/** Longest stored code (VARCHAR(64)); anything longer cannot exist. */
const MAX_CODE_LENGTH = 64;

export type GoneReason = 'disabled' | 'expired' | 'exhausted';

export type Resolution =
  | { kind: 'redirect'; linkId: number; targetUrl: string; counted: boolean }
  | { kind: 'gone'; reason: GoneReason }
  | { kind: 'not_found' };

export interface ResolveOptions {
  /**
   * A person's GET: consumes max_clicks. Bots and HEAD requests only check the limit
   * (DECISIONS D-001).
   */
  countable: boolean;
  now?: Date;
}

const NOT_FOUND: Resolution = { kind: 'not_found' };

function toCached(row: RedirectRow): CachedLink {
  return {
    id: Number(row.id),
    targetUrl: row.target_url,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    maxClicks: row.max_clicks,
  };
}

function goneReason(
  link: Pick<CachedLink, 'isActive' | 'expiresAt'>,
  now: Date,
  exhausted = false,
): GoneReason | null {
  if (!link.isActive) return 'disabled';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'expired';
  return exhausted ? 'exhausted' : null;
}

export function createResolver(repo: RedirectRepository, cache: LinkCache) {
  /** Fresh state straight from the database: the cache never decides for max_clicks links. */
  async function decideFromDb(id: number, now: Date): Promise<Resolution> {
    const row = await repo.findById(id);
    if (!row) return NOT_FOUND;
    const link = toCached(row);
    const exhausted = row.max_clicks !== null && row.click_count >= row.max_clicks;
    const reason = goneReason(link, now, exhausted);
    if (reason) return { kind: 'gone', reason };
    return { kind: 'redirect', linkId: link.id, targetUrl: link.targetUrl, counted: false };
  }

  return {
    /** `code` must already be normalised (NFC + lowercase). */
    async resolve(code: string, options: ResolveOptions): Promise<Resolution> {
      const now = options.now ?? new Date();
      if (code === '' || Array.from(code).length > MAX_CODE_LENGTH || isReservedCode(code)) {
        return NOT_FOUND;
      }

      let link = cache.get(code);
      if (link === null) return NOT_FOUND;
      if (link === undefined) {
        const row = await repo.findByCode(code);
        if (!row) {
          cache.setMissing(code);
          return NOT_FOUND;
        }
        link = toCached(row);
        cache.setFound(code, link);
      }

      if (link.maxClicks === null) {
        // Expiry is evaluated now, never cached as a decision.
        const reason = goneReason(link, now);
        if (reason) return { kind: 'gone', reason };
        return { kind: 'redirect', linkId: link.id, targetUrl: link.targetUrl, counted: false };
      }

      if (!options.countable) return decideFromDb(link.id, now);
      const targetUrl = await repo.consumeVisit(link.id);
      if (targetUrl !== null)
        return { kind: 'redirect', linkId: link.id, targetUrl, counted: true };
      // Not consumed: find out why for the 410 page (only on this failure path).
      const fresh = await decideFromDb(link.id, now);
      // Still valid here means another visitor took the last slot between the UPDATE and this read.
      return fresh.kind === 'redirect' ? { kind: 'gone', reason: 'exhausted' } : fresh;
    },
  };
}

export type Resolver = ReturnType<typeof createResolver>;
