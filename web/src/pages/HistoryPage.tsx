import { useEffect, useState } from 'react';
import { api, ApiError, type Link } from '../api';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  Loading,
  QrDialog,
  StatusBadge,
} from '../components/ui';
import { displayShortUrl, formatDateTime, formatNumber, truncateMiddle } from '../format';
import { href } from '../router';

const PAGE_SIZE = 20;

const messageOf = (err: unknown) =>
  err instanceof ApiError ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่';

export function HistoryPage() {
  const [items, setItems] = useState<Link[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [qrLink, setQrLink] = useState<Link | null>(null);
  const [toDelete, setToDelete] = useState<Link | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Bumped by "ลองใหม่" to fetch the first page again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.listLinks(null, PAGE_SIZE).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setState('ready');
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(messageOf(err));
        setState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setState('loading');
    setAttempt((n) => n + 1);
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.listLinks(cursor, PAGE_SIZE);
      // A link created meanwhile cannot appear twice (keyset paging), but dedupe anyway.
      setItems((prev) => [...prev, ...page.items.filter((n) => !prev.some((p) => p.id === n.id))]);
      setCursor(page.nextCursor);
    } catch (err) {
      setMoreError(messageOf(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleActive = async (link: Link) => {
    setPendingId(link.id);
    setActionError(null);
    try {
      const updated = await api.updateLink(link.id, { isActive: !link.isActive });
      setItems((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setPendingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteLink(toDelete.id);
      setItems((prev) => prev.filter((l) => l.id !== toDelete.id));
      setToDelete(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already gone (e.g. deleted in another tab): treat as done.
        setItems((prev) => prev.filter((l) => l.id !== toDelete.id));
        setToDelete(null);
      } else {
        setDeleteError(messageOf(err));
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <div>
          <h1 className="page-title">ประวัติลิงก์</h1>
          <p className="page-lead" style={{ margin: 0 }}>
            ลิงก์ทั้งหมดที่สร้างจากเบราว์เซอร์นี้ (ไม่มีระบบสมาชิก ระบบจำผ่าน cookie)
          </p>
        </div>
        <a className="btn btn-primary" href={href.create()}>
          + สร้างลิงก์ใหม่
        </a>
      </div>

      {actionError ? (
        <div className="alert" role="alert">
          {actionError}
        </div>
      ) : null}

      {state === 'loading' ? <Loading label="กำลังโหลดประวัติ…" /> : null}
      {state === 'error' ? <ErrorState message={loadError} onRetry={retry} /> : null}
      {state === 'ready' && items.length === 0 ? (
        <div className="card">
          <EmptyState
            title="ยังไม่มีลิงก์"
            action={
              <a className="btn btn-primary" href={href.create()}>
                สร้างลิงก์แรก
              </a>
            }
          >
            ลิงก์ที่คุณสร้างจะแสดงที่นี่ พร้อมจำนวนคลิกและสแกน
          </EmptyState>
        </div>
      ) : null}

      {state === 'ready' && items.length > 0 ? (
        <>
          <ul className="link-list">
            {items.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                pending={pendingId === link.id}
                onToggle={() => void toggleActive(link)}
                onQr={() => {
                  setQrLink(link);
                }}
                onDelete={() => {
                  setDeleteError(null);
                  setToDelete(link);
                }}
              />
            ))}
          </ul>
          {cursor || moreError ? (
            <div className="load-more">
              {moreError ? (
                <div className="alert" role="alert">
                  {moreError}
                </div>
              ) : null}
              {cursor ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <QrDialog
        link={qrLink}
        onClose={() => {
          setQrLink(null);
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title="ลบลิงก์นี้?"
        message={
          toDelete ? (
            <>
              <strong>{displayShortUrl(toDelete.shortUrl)}</strong> และสถิติทั้งหมดจะถูกลบถาวร
              ลิงก์นี้และ QR Code ที่พิมพ์ไปแล้วจะใช้ไม่ได้อีก
            </>
          ) : null
        }
        confirmLabel="ลบถาวร"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) setToDelete(null);
        }}
      />
    </>
  );
}

function LinkRow({
  link,
  pending,
  onToggle,
  onQr,
  onDelete,
}: {
  link: Link;
  pending: boolean;
  onToggle: () => void;
  onQr: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={`link-item${link.status === 'active' ? '' : ' is-off'}`}>
      <div className="link-main">
        <div className="link-short">
          <a href={link.shortUrl} target="_blank" rel="noreferrer">
            {displayShortUrl(link.shortUrl)}
          </a>
          <StatusBadge status={link.status} />
        </div>
        <p className="link-target" title={link.targetUrl}>
          {truncateMiddle(link.targetUrl, 80)}
        </p>
        <div className="link-meta">
          <span>สร้างเมื่อ {formatDateTime(link.createdAt)}</span>
          {link.expiresAt !== null ? <span>หมดอายุ {formatDateTime(link.expiresAt)}</span> : null}
          {link.maxClicks !== null ? <span>จำกัด {formatNumber(link.maxClicks)} ครั้ง</span> : null}
        </div>
      </div>
      <div className="counts">
        <div className="count count-click">
          <strong>{formatNumber(link.clickCount)}</strong>
          <span>คลิก</span>
        </div>
        <div className="count count-qr">
          <strong>{formatNumber(link.qrScanCount)}</strong>
          <span>สแกน</span>
        </div>
      </div>
      <div className="link-actions">
        <CopyButton text={link.shortUrl} className="btn btn-sm" />
        <a className="btn btn-sm" href={link.shortUrl} target="_blank" rel="noreferrer">
          เปิด ↗
        </a>
        <button type="button" className="btn btn-sm" onClick={onQr}>
          QR
        </button>
        <a className="btn btn-sm" href={href.dashboard(link.id)}>
          สถิติ
        </a>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onToggle}
          disabled={pending}
          aria-pressed={link.isActive}
        >
          {pending ? 'กำลังบันทึก…' : link.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
          ลบ
        </button>
      </div>
    </li>
  );
}
