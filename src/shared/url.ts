import { BlockList, isIPv4, isIPv6 } from 'node:net';

export const MAX_URL_LENGTH = 2048;

export type UrlRejection =
  'TOO_LONG' | 'INVALID_URL' | 'UNSUPPORTED_SCHEME' | 'USERINFO' | 'PRIVATE_HOST' | 'SELF_HOST';

export type UrlValidation = { ok: true; url: string } | { ok: false; reason: UrlRejection };

/** User-facing (Thai) messages for each rejection reason. */
export const URL_REJECTION_MESSAGES: Record<UrlRejection, string> = {
  TOO_LONG: `URL ยาวเกิน ${MAX_URL_LENGTH} ตัวอักษร`,
  INVALID_URL: 'รูปแบบ URL ไม่ถูกต้อง',
  UNSUPPORTED_SCHEME: 'รองรับเฉพาะ URL ที่ขึ้นต้นด้วย http:// หรือ https://',
  USERINFO: 'URL ต้องไม่มีชื่อผู้ใช้หรือรหัสผ่าน',
  PRIVATE_HOST: 'ไม่อนุญาตให้ลิงก์ไปยัง localhost หรือเครือข่ายภายใน',
  SELF_HOST: 'ไม่อนุญาตให้ลิงก์กลับมายังโดเมนของระบบเอง',
};

// Non-public address ranges (loopback, private, link-local, CGNAT, unspecified, multicast, reserved).
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Lowercase and strip trailing dots so `LOCALHOST.` and `localhost` compare equal. */
function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}

/** Extract the embedded IPv4 address of an IPv4-mapped/compatible IPv6 address (`::ffff:7f00:1`). */
function embeddedIPv4(ipv6: string): string | null {
  const m = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv6);
  if (!m?.[1] || !m[2]) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** True for localhost names and IP literals in non-public ranges. */
export function isPrivateHost(hostname: string): boolean {
  const host = canonicalHost(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // WHATWG URL wraps IPv6 in brackets and already normalises IPv4 forms like 0x7f.1 or 2130706433.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIPv4(bare)) return blocked.check(bare, 'ipv4');
  if (isIPv6(bare)) {
    const v4 = embeddedIPv4(bare);
    if (v4 !== null) return blocked.check(v4, 'ipv4');
    return blocked.check(bare, 'ipv6');
  }
  return false;
}

export interface ValidateUrlOptions {
  /** Hostnames of this service (from BASE_URL); linking to them would loop. */
  selfHosts: readonly string[];
}

/**
 * Strictly validate a destination URL (SPEC §4). The API never adds a missing scheme;
 * that convenience belongs to the UI. Returns the normalised href on success.
 */
export function validateTargetUrl(input: string, options: ValidateUrlOptions): UrlValidation {
  if (input.length > MAX_URL_LENGTH) return { ok: false, reason: 'TOO_LONG' };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'INVALID_URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'UNSUPPORTED_SCHEME' };
  }
  if (url.hostname === '') return { ok: false, reason: 'INVALID_URL' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'USERINFO' };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: 'PRIVATE_HOST' };

  const host = canonicalHost(url.hostname);
  if (options.selfHosts.some((h) => canonicalHost(h) === host)) {
    return { ok: false, reason: 'SELF_HOST' };
  }

  if (url.href.length > MAX_URL_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, url: url.href };
}
