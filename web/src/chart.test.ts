import { describe, expect, it } from 'vitest';
import { areaPath, labelIndexes, linePath, niceMax, ticks, toPoints } from './chart';

describe('niceMax', () => {
  it.each([
    [0, 4],
    [1, 4],
    [4, 4],
    [5, 8],
    [9, 20],
    [37, 40],
    [99, 100],
    [101, 200],
    [999, 1000],
  ])('%i → %i', (value, expected) => {
    expect(niceMax(value)).toBe(expected);
  });

  it('always gives whole-number ticks', () => {
    for (let v = 0; v < 5000; v += 7) {
      expect(ticks(niceMax(v)).every(Number.isInteger)).toBe(true);
    }
  });
});

describe('points and paths', () => {
  const box = { width: 100, height: 60, top: 10, right: 0, bottom: 10, left: 0 };

  it('maps values into the inner box, zero on the baseline', () => {
    expect(toPoints([0, 4, 2], 4, box)).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 10 },
      { x: 100, y: 30 },
    ]);
  });

  it('centres a single value', () => {
    expect(toPoints([1], 4, box)[0]?.x).toBe(50);
  });

  it('builds line and area paths', () => {
    const pts = toPoints([0, 4], 4, box);
    expect(linePath(pts)).toBe('M0,50 L100,10');
    expect(areaPath(pts, 50)).toBe('M0,50 L100,10 L100,50 L0,50 Z');
    expect(areaPath([], 50)).toBe('');
  });
});

describe('labelIndexes', () => {
  it('shows every label when they fit', () => {
    expect(labelIndexes(7, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('thins a 30-day axis but keeps the first and last day', () => {
    const idx = labelIndexes(30, 6);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(29);
    expect(idx.length).toBeLessThanOrEqual(6);
  });
});
