export interface LruOptions {
  maxSize: number;
  ttlMs: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
}

/**
 * Small in-memory LRU with a per-entry TTL. A Map keeps insertion order, so re-inserting
 * on every hit makes the first key the least recently used.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: LruOptions) {
    this.now = options.now ?? Date.now;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxSize) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
