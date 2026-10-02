import type { LinkStatus } from './api';

export const TIME_ZONE = 'Asia/Bangkok';

/**
 * SPEC §4: if the user typed no scheme, the UI adds `https://`. The API still validates
 * strictly, so anything odd ("ftp://x", "javascript:") is passed through and rejected there.
 */
export function normalizeUrlInput(raw: string): string {
  const value = raw.trim();
  if (value === '') return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^:/]+:\d+(\/|$)/.test(value)) return value;
  return `https://${value.replace(/^\/+/, '')}`;
}

/**
 * `<input type="datetime-local">` gives wall-clock time without a zone; the API needs
 * ISO 8601 with an offset. Interpreted in the browser's own time zone, which is what the
 * person picking the date sees.
 */
export function localInputToIso(value: string): string | undefined {
  if (value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Value for `<input type="datetime-local" min=...>` in the browser's time zone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const dateTimeFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dayFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const numberFormat = new Intl.NumberFormat('th-TH');

/** e.g. "3 ต.ค. 2569 14:05" in Bangkok time. */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** `byDay.day` is a calendar date ("2026-10-03"); format it without shifting zones. */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** Share of `part` in `total` as a whole percent; 0 when there is nothing yet. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

const RELATIVE = new Intl.RelativeTimeFormat('th-TH', { numeric: 'auto' });

/** "เมื่อสักครู่", "5 นาทีที่แล้ว", ... falls back to the full date after a week. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'เมื่อสักครู่';
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return RELATIVE.format(Math.round(seconds / 86_400), 'day');
  return formatDateTime(iso);
}

/** Shorten long target URLs for lists; the full URL goes in a `title` attribute. */
export function truncateMiddle(value: string, max = 60): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.65);
  const tail = max - 1 - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/** Short URL without the scheme, for display ("pulse.example/กาแฟ"). */
export function displayShortUrl(shortUrl: string): string {
  try {
    const url = new URL(shortUrl);
    return `${url.host}${decodeURIComponent(url.pathname)}`;
  } catch {
    return shortUrl;
  }
}

export const STATUS_LABELS: Record<LinkStatus, string> = {
  active: 'ใช้งาน',
  expired: 'หมดอายุ',
  disabled: 'ปิด',
  exhausted: 'ครบจำนวน',
};

const DEVICE_LABELS: Record<string, string> = {
  mobile: 'มือถือ',
  tablet: 'แท็บเล็ต',
  desktop: 'คอมพิวเตอร์',
  bot: 'บอท',
  unknown: 'ไม่ทราบ',
};

export function deviceLabel(device: string | null): string {
  return device === null ? 'ไม่ทราบ' : (DEVICE_LABELS[device] ?? device);
}

/** D-024: `browser: null` → "ไม่ทราบ". */
export function browserLabel(browser: string | null): string {
  return browser ?? 'ไม่ทราบ';
}

/** D-024: no Referer (typed in, chat apps, QR scanners) → "เปิดตรง". */
export function referrerLabel(host: string | null): string {
  return host ?? 'เปิดตรง';
}

export function sourceLabel(source: 'click' | 'qr'): string {
  return source === 'qr' ? 'สแกน QR' : 'คลิก';
}
