import { type PointerEvent, useEffect, useRef, useState } from 'react';
import type { LinkStats } from '../api';
import { areaPath, type Box, labelIndexes, linePath, niceMax, ticks, toPoints } from '../chart';
import { formatDay, formatNumber } from '../format';

const MARGINS = { top: 12, right: 12, bottom: 28, left: 36 };

/** Track an element's width so the SVG is drawn 1:1 and its text stays legible on phones. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

/** Daily clicks (mint) and QR scans (coral) as two lines over the Bangkok calendar days. */
export function DailyChart({ byDay }: { byDay: LinkStats['byDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const box: Box = { width, height: width < 480 ? 200 : 240, ...MARGINS };
  const max = niceMax(Math.max(0, ...byDay.map((d) => Math.max(d.clicks, d.qrScans))));
  const clicks = toPoints(
    byDay.map((d) => d.clicks),
    max,
    box,
  );
  const scans = toPoints(
    byDay.map((d) => d.qrScans),
    max,
    box,
  );
  const baseY = box.height - box.bottom;
  const labels = labelIndexes(byDay.length, Math.max(3, Math.floor((width - 40) / 64)));
  const total = byDay.reduce((sum, d) => sum + d.clicks + d.qrScans, 0);
  const hovered = hover === null ? undefined : byDay[hover];
  const hoverX = hover === null ? 0 : (clicks[hover]?.x ?? 0);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * box.width;
    let nearest = 0;
    clicks.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs((clicks[nearest]?.x ?? 0) - x)) nearest = i;
    });
    setHover(nearest);
  };

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        className="line-chart"
        viewBox={`0 0 ${box.width} ${box.height}`}
        role="img"
        aria-label={`กราฟรายวัน ${byDay.length} วัน รวม ${formatNumber(total)} ครั้ง`}
        onPointerMove={onMove}
        onPointerLeave={() => {
          setHover(null);
        }}
      >
        <defs>
          <linearGradient id="fill-click" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3df5a7" stopOpacity="0.28" />
            <stop offset="1" stopColor="#3df5a7" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fill-qr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff5c7a" stopOpacity="0.2" />
            <stop offset="1" stopColor="#ff5c7a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="grid">
          {ticks(max).map((t) => {
            const y = baseY - (t / max) * (baseY - box.top);
            return (
              <g key={t}>
                <line x1={box.left} x2={box.width - box.right} y1={y} y2={y} />
                <text x={box.left - 8} y={y + 4} textAnchor="end">
                  {formatNumber(t)}
                </text>
              </g>
            );
          })}
        </g>
        {labels.map((i) => {
          const day = byDay[i];
          const p = clicks[i];
          if (!day || !p) return null;
          return (
            <text key={day.day} x={p.x} y={box.height - 6} textAnchor="middle">
              {formatDay(day.day)}
            </text>
          );
        })}
        <path d={areaPath(clicks, baseY)} fill="url(#fill-click)" />
        <path d={areaPath(scans, baseY)} fill="url(#fill-qr)" />
        <path className="series series-qr" d={linePath(scans)} />
        <path className="series series-click" d={linePath(clicks)} />
        {hover !== null ? (
          <g>
            <line className="hover-line" x1={hoverX} x2={hoverX} y1={box.top} y2={baseY} />
            <circle cx={hoverX} cy={clicks[hover]?.y} r="4" fill="#3df5a7" />
            <circle cx={hoverX} cy={scans[hover]?.y} r="4" fill="#ff5c7a" />
          </g>
        ) : null}
      </svg>
      {hovered ? (
        <div className="chart-tip" style={{ left: `${(hoverX / box.width) * 100}%` }}>
          {formatDay(hovered.day)} · <b style={{ color: '#3df5a7' }}>คลิก {hovered.clicks}</b> ·{' '}
          <b style={{ color: '#ff5c7a' }}>สแกน {hovered.qrScans}</b>
        </div>
      ) : null}
      <table className="visually-hidden">
        <caption>จำนวนคลิกและสแกนรายวัน</caption>
        <thead>
          <tr>
            <th>วันที่</th>
            <th>คลิก</th>
            <th>สแกน QR</th>
          </tr>
        </thead>
        <tbody>
          {byDay.map((d) => (
            <tr key={d.day}>
              <td>{formatDay(d.day)}</td>
              <td>{d.clicks}</td>
              <td>{d.qrScans}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BarList({
  rows,
  empty = 'ยังไม่มีข้อมูลในช่วงนี้',
}: {
  rows: { label: string; count: number }[];
  empty?: string;
}) {
  if (rows.length === 0) return <p className="muted-note">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label} className="bar-row">
          <div className="bar-row-head">
            <span title={r.label}>{r.label}</span>
            <span>
              {formatNumber(r.count)} · {total > 0 ? Math.round((r.count / total) * 100) : 0}%
            </span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${max > 0 ? (r.count / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
