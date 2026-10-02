import UAParser from 'ua-parser-js';

export type Device = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';

export interface ParsedClient {
  device: Device;
  browser: string | null;
  os: string | null;
}

// Column widths in clicks (SPEC §3).
const BROWSER_MAX = 64;
const OS_MAX = 64;
const REFERRER_HOST_MAX = 255;

const truncate = (value: string | undefined, max: number): string | null =>
  value ? value.slice(0, max) : null;

/**
 * Device, browser and OS for the clicks table. `isBot` comes from the redirect (shared/bot.ts),
 * which already decided it at request time.
 */
export function parseUserAgent(userAgent: string | undefined, isBot: boolean): ParsedClient {
  const ua = userAgent?.trim() ?? '';
  const result = new UAParser(ua).getResult();

  let browser = result.browser.name;
  // ua-parser-js 1.x reports LINE's in-app browser as "WebKit"; it is common in Thailand.
  if (/\bLine\/\d/.test(ua)) browser = 'LINE';
  // Non-browser clients (curl/8.4.0, python-requests/2.31): use the product token.
  browser ??= /^([\w.-]+)\//.exec(ua)?.[1];

  const os = result.os.name;
  let device: Device;
  if (isBot) device = 'bot';
  else if (result.device.type === 'mobile' || result.device.type === 'tablet') {
    device = result.device.type;
  } else if (os || result.browser.name) device = 'desktop';
  else device = 'unknown';

  return { device, browser: truncate(browser, BROWSER_MAX), os: truncate(os, OS_MAX) };
}

/** Hostname of an http(s) Referer header, or null. The path and query are never stored. */
export function referrerHost(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().slice(0, REFERRER_HOST_MAX) || null;
  } catch {
    return null;
  }
}
