// Geometry for the daily line chart, kept free of React so it can be unit tested.
// Hand-drawn SVG instead of a chart library: two lines and a few bars do not justify
// another dependency (CLAUDE.md: no extra dependencies without a reason).

/**
 * Smallest axis maximum ≥ value whose `count` ticks are whole "nice" steps
 * (1, 2, 2.5, 5 × 10^n; 2.5 only from 25 up so counts stay integers).
 */
export function niceMax(value: number, count = 4): number {
  const raw = Math.max(value, 1) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const step = factor * magnitude;
    if (!Number.isInteger(step)) continue;
    if (step >= raw) return step * count;
  }
  return 10 * magnitude * count;
}

/** Evenly spaced tick values from 0 to max (inclusive). */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

export interface Box {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Plot values left to right across the box; a single value sits in the middle. */
export function toPoints(values: number[], max: number, box: Box): Point[] {
  const innerW = box.width - box.left - box.right;
  const innerH = box.height - box.top - box.bottom;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: box.left + (values.length > 1 ? i * step : innerW / 2),
    y: box.top + innerH - (max > 0 ? (v / max) * innerH : 0),
  }));
}

const round = (n: number) => Math.round(n * 10) / 10;

export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`).join(' ');
}

/** Closed area under a line, down to `baseY`. */
export function areaPath(points: Point[], baseY: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points)} L${round(last.x)},${round(baseY)} L${round(first.x)},${round(baseY)} Z`;
}

/** Which label indexes to show so a 30-day axis does not overlap (always first and last). */
export function labelIndexes(length: number, maxLabels: number): number[] {
  if (length <= maxLabels) return Array.from({ length }, (_, i) => i);
  const every = Math.ceil((length - 1) / (maxLabels - 1));
  const out: number[] = [];
  for (let i = 0; i < length - 1; i += every) out.push(i);
  // Drop the previous label if it would crowd the last one.
  if (length - 1 - (out[out.length - 1] ?? 0) < every * 0.75) out.pop();
  out.push(length - 1);
  return out;
}
