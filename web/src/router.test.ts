import { describe, expect, it } from 'vitest';
import { href, parseHash } from './router';

describe('parseHash', () => {
  it.each([
    ['', { name: 'create' }],
    ['#', { name: 'create' }],
    ['#/', { name: 'create' }],
    ['#/history', { name: 'history' }],
    ['#/history/', { name: 'history' }],
    ['#/links/42', { name: 'dashboard', id: 42 }],
    ['#/links/0', { name: 'notFound' }],
    ['#/links/abc', { name: 'notFound' }],
    ['#/links/99999999999999999', { name: 'notFound' }],
    ['#/nope', { name: 'notFound' }],
  ])('%s', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });

  it('round-trips the hrefs it builds', () => {
    expect(parseHash(href.create())).toEqual({ name: 'create' });
    expect(parseHash(href.history())).toEqual({ name: 'history' });
    expect(parseHash(href.dashboard(7))).toEqual({ name: 'dashboard', id: 7 });
  });
});
