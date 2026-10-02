import { type ReactNode, useEffect, useRef } from 'react';
import { type Link, type LinkStatus, qrImageUrl } from '../api';
import { STATUS_LABELS } from '../format';
import { useCopy } from '../hooks';

const PULSE_PATH = 'M2 22h22l6-14 8 26 7-18 5 6h68';

export function Loading({ label = 'กำลังโหลด…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <svg className="spinner" viewBox="0 0 120 40" aria-hidden="true">
        <path d={PULSE_PATH} />
      </svg>
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <svg className="state-icon" viewBox="0 0 120 40" aria-hidden="true">
        <path d="M2 22h116" />
      </svg>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state is-error" role="alert">
      <svg className="state-icon" viewBox="0 0 120 40" aria-hidden="true">
        <path d="M2 22h40l6-14 6 26 6-12h58" />
      </svg>
      <h2>โหลดข้อมูลไม่สำเร็จ</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          ลองใหม่
        </button>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: LinkStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function LiveDot({ active }: { active: boolean }) {
  return (
    <span className={`live${active ? '' : ' is-paused'}`}>
      <span className="live-dot" aria-hidden="true" />
      {active ? 'Live · อัปเดตทุก 5 วินาที' : 'หยุดอัปเดตชั่วคราว'}
    </span>
  );
}

export function CopyButton({
  text,
  label = 'คัดลอก',
  className = 'btn',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={`${className}${copied ? ' is-done' : ''}`}
      onClick={() => void copy(text)}
      aria-live="polite"
    >
      {copied ? 'คัดลอกแล้ว ✓' : label}
    </button>
  );
}

export function QrDownloads({ link, small = false }: { link: Link; small?: boolean }) {
  const cls = small ? 'btn btn-sm' : 'btn';
  return (
    <>
      <a className={cls} href={qrImageUrl(link, { format: 'png', size: 1024, download: true })}>
        ดาวน์โหลด PNG
      </a>
      <a className={cls} href={qrImageUrl(link, { format: 'svg', download: true })}>
        ดาวน์โหลด SVG
      </a>
    </>
  );
}

export function QrImage({ link, size = 360 }: { link: Link; size?: number }) {
  return (
    <img
      className="qr-img"
      src={qrImageUrl(link, { format: 'svg' })}
      width={size}
      height={size}
      alt={`QR Code ของ ${link.shortUrl}`}
    />
  );
}

/** Native <dialog>: focus trapping, Esc and the backdrop come from the browser. */
export function Dialog({
  open,
  onClose,
  labelledBy,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function QrDialog({ link, onClose }: { link: Link | null; onClose: () => void }) {
  return (
    <Dialog open={link !== null} onClose={onClose} labelledBy="qr-title" className="qr-dialog">
      {link ? (
        <>
          <h2 id="qr-title">QR Code</h2>
          <QrImage link={link} />
          <p>สแกนแล้วจะถูกนับเป็น “สแกน QR” แยกจากคลิก</p>
          <div className="btn-row">
            <QrDownloads link={link} />
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ปิด
            </button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      {error ? <div className="alert">{error}</div> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          ยกเลิก
        </button>
        <button type="button" className="btn btn-danger-solid" onClick={onConfirm} disabled={busy}>
          {busy ? 'กำลังลบ…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
