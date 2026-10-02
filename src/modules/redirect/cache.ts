import { LruCache } from '../../shared/lru.js';

/** What the redirect needs to decide without the database (links without max_clicks). */
export interface CachedLink {
  id: number;
  targetUrl: string;
  isActive: boolean;
  expiresAt: Date | null;
  maxClicks: number | null;
}

export interface LinkCacheOptions {
  now?: () => number;
}

// SPEC §2: 5000 entries / 60 s; misses 10 s. Misses live in their own, smaller LRU so that
// guessing random codes can never evict real links (user decision, P4 plan).
export const POSITIVE_MAX = 5000;
export const POSITIVE_TTL_MS = 60_000;
export const NEGATIVE_MAX = 1000;
export const NEGATIVE_TTL_MS = 10_000;

/**
 * Per-process cache of code → link. Invalidation only reaches this process; another process
 * (APP_MODE=api vs redirect) may serve a stale entry for up to the TTL (DECISIONS D-004).
 */
export class LinkCache {
  private readonly found: LruCache<string, CachedLink>;
  private readonly missing: LruCache<string, true>;

  constructor(options: LinkCacheOptions = {}) {
    this.found = new LruCache({ maxSize: POSITIVE_MAX, ttlMs: POSITIVE_TTL_MS, now: options.now });
    this.missing = new LruCache({
      maxSize: NEGATIVE_MAX,
      ttlMs: NEGATIVE_TTL_MS,
      now: options.now,
    });
  }

  /** The link, `null` for a cached miss, or `undefined` when nothing is cached. */
  get(code: string): CachedLink | null | undefined {
    const link = this.found.get(code);
    if (link) return link;
    return this.missing.get(code) ? null : undefined;
  }

  setFound(code: string, link: CachedLink): void {
    this.missing.delete(code);
    this.found.set(code, link);
  }

  setMissing(code: string): void {
    this.found.delete(code);
    this.missing.set(code, true);
  }

  /** Called by the links module after create/update/delete. */
  invalidate(code: string): void {
    this.found.delete(code);
    this.missing.delete(code);
  }

  get sizes(): { found: number; missing: number } {
    return { found: this.found.size, missing: this.missing.size };
  }
}
