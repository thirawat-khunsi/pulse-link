import { describe, expect, it } from 'vitest';
import {
  type CachedLink,
  LinkCache,
  NEGATIVE_MAX,
  NEGATIVE_TTL_MS,
  POSITIVE_TTL_MS,
} from '../../src/modules/redirect/cache.js';

const link = (id: number): CachedLink => ({
  id,
  targetUrl: `https://example.com/${id}`,
  isActive: true,
  expiresAt: null,
  maxClicks: null,
});

function setup() {
  let now = 0;
  const cache = new LinkCache({ now: () => now });
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('LinkCache', () => {
  it('distinguishes a hit, a cached miss and nothing cached', () => {
    const { cache } = setup();
    cache.setFound('a', link(1));
    cache.setMissing('b');
    expect(cache.get('a')).toEqual(link(1));
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBeUndefined();
  });

  it('keeps links for 60 s and misses for 10 s', () => {
    const { cache, advance } = setup();
    cache.setFound('a', link(1));
    cache.setMissing('b');
    advance(NEGATIVE_TTL_MS);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual(link(1));
    advance(POSITIVE_TTL_MS - NEGATIVE_TTL_MS);
    expect(cache.get('a')).toBeUndefined();
  });

  it('never lets guessed codes evict real links (separate negative LRU)', () => {
    const { cache } = setup();
    cache.setFound('real', link(1));
    for (let i = 0; i < NEGATIVE_MAX * 3; i++) cache.setMissing(`guess-${i}`);
    expect(cache.get('real')).toEqual(link(1));
    expect(cache.sizes).toEqual({ found: 1, missing: NEGATIVE_MAX });
  });

  it('invalidate clears both a link and a cached miss', () => {
    const { cache } = setup();
    cache.setFound('a', link(1));
    cache.setMissing('b');
    cache.invalidate('a');
    cache.invalidate('b');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('a found link replaces a cached miss and vice versa', () => {
    const { cache } = setup();
    cache.setMissing('a');
    cache.setFound('a', link(1));
    expect(cache.get('a')).toEqual(link(1));
    cache.setMissing('a');
    expect(cache.get('a')).toBeNull();
  });
});
