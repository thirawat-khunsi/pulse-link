import { useCallback, useRef, useState } from 'react';
import { api, ApiError, type Link, type LinkStats, type StatsDays } from '../api';
import { BarList, DailyChart } from '../components/charts';
import {
  CopyButton,
  EmptyState,
  ErrorState,
  LiveDot,
  Loading,
  QrDialog,
  StatusBadge,
} from '../components/ui';
import {
  browserLabel,
  deviceLabel,
  displayShortUrl,
  formatDateTime,
  formatNumber,
  formatRelative,
  percent,
  referrerLabel,
  sourceLabel,
} from '../format';
import { usePolling } from '../hooks';
import { href } from '../router';

const REFRESH_MS = 5000;

type Load =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; link: Link; stats: LinkStats };

/** Rendered with `key={id}` so switching links starts from a fresh loading state. */
export function DashboardPage({ id }: { id: number }) {
  const [days, setDays] = useState<StatsDays>(7);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // A failed background refresh keeps the last data on screen and shows a small notice.
  const [staleError, setStaleError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++request.current;
    try {
      const [link, stats] = await Promise.all([api.getLink(id), api.getStats(id, days)]);
      if (seq !== request.current) return; // a newer request (e.g. 7 → 30 days) won
      setLoad({ kind: 'ready', link, stats });
      setStaleError(null);
      setNow(new Date());
    } catch (err) {
      if (seq !== request.current) return;
      if (err instanceof ApiError && err.status === 404) {
        setLoad({ kind: 'notFound' });
        return;
      }
      const message = err instanceof ApiError ? err.message : 'โหลดสถิติไม่สำเร็จ';
      setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'error', message }));
      setStaleError(message);
    }
  }, [id, days]);

  const live = usePolling(refresh, REFRESH_MS, load.kind !== 'notFound');

  if (load.kind === 'loading') return <Loading label="กำลังโหลดสถิติ…" />;
  if (load.kind === 'notFound') {
    return (
      <div className="card">
        <EmptyState
          title="ไม่พบลิงก์นี้"
          action={
            <a className="btn" href={href.history()}>
              กลับไปหน้าประวัติ
            </a>
          }
        >
          ลิงก์อาจถูกลบไปแล้ว หรือเป็นลิงก์ที่สร้างจากเบราว์เซอร์อื่น
        </EmptyState>
      </div>
    );
  }
  if (load.kind === 'error') {
    return <ErrorState message={load.message} onRetry={() => void refresh()} />;
  }

  const { link, stats } = load;
  const { clicks, qrScans, bots } = stats.totals;
  const total = clicks + qrScans;
  const clickShare = percent(clicks, total);

  return (
    <>
      <a className="back" href={href.history()}>
        ← ประวัติลิงก์
      </a>
      <div className="dash-head">
        <div style={{ minWidth: 0 }}>
          <div className="link-short" style={{ marginBottom: 4 }}>
            <StatusBadge status={link.status} />
            <LiveDot active={live && staleError === null} />
          </div>
          <h1>{displayShortUrl(link.shortUrl)}</h1>
          <p className="target" title={link.targetUrl}>
            → {link.targetUrl}
          </p>
        </div>
        <div className="btn-row">
          <CopyButton text={link.shortUrl} />
          <a className="btn" href={link.shortUrl} target="_blank" rel="noreferrer">
            เปิด ↗
          </a>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setShowQr(true);
            }}
          >
            QR Code
          </button>
        </div>
      </div>

      {staleError ? (
        <div className="alert" role="status" style={{ marginBottom: 16 }}>
          อัปเดตล่าสุดไม่สำเร็จ ({staleError}) — แสดงข้อมูลเมื่อ {formatDateTime(now.toISOString())}
        </div>
      ) : null}

      <div className="stat-cards">
        <div className="card stat stat-click">
          <span className="stat-label">คลิก</span>
          <strong className="stat-value">{formatNumber(clicks)}</strong>
          <span className="stat-sub">ตลอดอายุลิงก์</span>
        </div>
        <div className="card stat stat-qr">
          <span className="stat-label">สแกน QR</span>
          <strong className="stat-value">{formatNumber(qrScans)}</strong>
          <span className="stat-sub">ตลอดอายุลิงก์</span>
        </div>
        <div className="card stat stat-split">
          <span className="stat-label">สัดส่วนคลิก : สแกน</span>
          <div
            className="split-bar"
            role="img"
            aria-label={`คลิก ${clickShare}% สแกน ${total > 0 ? 100 - clickShare : 0}%`}
          >
            <span style={{ width: `${total > 0 ? clickShare : 0}%` }} />
            <span style={{ width: `${total > 0 ? 100 - clickShare : 0}%` }} />
          </div>
          <div className="split-legend">
            <span style={{ color: 'var(--mint)' }}>คลิก {clickShare}%</span>
            <span style={{ color: 'var(--coral)' }}>สแกน {total > 0 ? 100 - clickShare : 0}%</span>
          </div>
          <span className="stat-sub">
            รวม {formatNumber(total)} ครั้ง · กรองบอทออก {formatNumber(bots)} ครั้ง
          </span>
        </div>
      </div>

      <section className="card" aria-labelledby="daily-title">
        <div className="chart-head">
          <h2 className="card-title" id="daily-title">
            รายวัน (เวลาไทย)
          </h2>
          <div className="legend" aria-hidden="true">
            <span>
              <i style={{ background: 'var(--mint)' }} />
              คลิก
            </span>
            <span>
              <i style={{ background: 'var(--coral)' }} />
              สแกน QR
            </span>
          </div>
          <div className="segmented" role="group" aria-label="ช่วงเวลา">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => {
                  setDays(d);
                }}
              >
                {d} วัน
              </button>
            ))}
          </div>
        </div>
        <DailyChart byDay={stats.byDay} />
      </section>

      <div className="grid-3">
        <section className="card" aria-labelledby="device-title">
          <h2 className="card-title" id="device-title">
            อุปกรณ์
          </h2>
          <BarList
            rows={stats.byDevice.map((r) => ({ label: deviceLabel(r.device), count: r.count }))}
          />
        </section>
        <section className="card" aria-labelledby="browser-title">
          <h2 className="card-title" id="browser-title">
            เบราว์เซอร์
          </h2>
          <BarList
            rows={stats.byBrowser.map((r) => ({ label: browserLabel(r.browser), count: r.count }))}
          />
        </section>
        <section className="card" aria-labelledby="referrer-title">
          <h2 className="card-title" id="referrer-title">
            ที่มา (Referrer)
          </h2>
          <BarList
            rows={stats.byReferrer.map((r) => ({ label: referrerLabel(r.host), count: r.count }))}
          />
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="recent-title">
        <h2 className="card-title" id="recent-title">
          คลิกล่าสุด
        </h2>
        <RecentTable recent={stats.recent} now={now} />
      </section>

      <QrDialog
        link={showQr ? link : null}
        onClose={() => {
          setShowQr(false);
        }}
      />
    </>
  );
}

function RecentTable({ recent, now }: { recent: LinkStats['recent']; now: Date }) {
  // Highlight rows that arrived since the previous refresh ("adjust state while rendering").
  const [shown, setShown] = useState(recent);
  const [previousTop, setPreviousTop] = useState<string | null>(null);
  if (recent !== shown) {
    setPreviousTop(shown[0]?.clickedAt ?? null);
    setShown(recent);
  }

  if (recent.length === 0) {
    return <p className="muted-note">ยังไม่มีคนคลิกหรือสแกน ลองเปิดลิงก์หรือสแกน QR ดูสิ</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>เวลา</th>
            <th>ช่องทาง</th>
            <th>อุปกรณ์</th>
            <th>เบราว์เซอร์</th>
            <th>ระบบปฏิบัติการ</th>
            <th>ที่มา</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => {
            const isNew = previousTop !== null && r.clickedAt > previousTop;
            return (
              <tr key={`${r.clickedAt}-${i}`} className={isNew ? 'is-new' : undefined}>
                <td title={formatDateTime(r.clickedAt)}>{formatRelative(r.clickedAt, now)}</td>
                <td>
                  <span className={`src src-${r.source}`}>{sourceLabel(r.source)}</span>
                </td>
                <td>{deviceLabel(r.device)}</td>
                <td>{browserLabel(r.browser)}</td>
                <td>{r.os ?? 'ไม่ทราบ'}</td>
                <td>{referrerLabel(r.referrerHost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
