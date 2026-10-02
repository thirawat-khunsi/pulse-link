import { describe, expect, it } from 'vitest';
import { LruCache } from '../../src/shared/lru.js';

function cache(maxSize: number, ttlMs: number) {
  let now = 0;
  const lru = new LruCache<string, number>({ maxSize, ttlMs, now: () => now });
  return { lru, advance: (ms: number) => (now += ms) };
}

describe('LruCache', () => {
  it('returns values until their TTL elapses', () => {
    const { lru, advance } = cache(10, 60_000);
    lru.set('a', 1);
    advance(59_999);
    expect(lru.get('a')).toBe(1);
    advance(1);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.size).toBe(0);
  });

  it('evicts the least recently used entry beyond maxSize', () => {
    const { lru } = cache(2, 60_000);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now most recent
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
    expect(lru.size).toBe(2);
  });

  it('re-setting a key refreshes its TTL and position; delete removes it', () => {
    const { lru, advance } = cache(2, 1_000);
    lru.set('a', 1);
    advance(900);
    lru.set('a', 2);
    advance(900);
    expect(lru.get('a')).toBe(2);
    lru.delete('a');
    expect(lru.get('a')).toBeUndefined();
  });
});
