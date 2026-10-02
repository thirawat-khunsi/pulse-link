import { describe, expect, it } from 'vitest';
import {
  browserLabel,
  deviceLabel,
  displayShortUrl,
  formatDay,
  formatRelative,
  localInputToIso,
  normalizeUrlInput,
  percent,
  referrerLabel,
  safeDecode,
  STATUS_LABELS,
  truncateMiddle,
} from './format';

describe('normalizeUrlInput (SPEC §4: UI adds https://)', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  example.com/a?b=1  ', 'https://example.com/a?b=1'],
    ['www.กาแฟ.com', 'https://www.กาแฟ.com'],
    ['localhost:3000/x', 'https://localhost:3000/x'],
    ['example.com:8080', 'https://example.com:8080'],
    ['//example.com', 'https://example.com'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrlInput(input)).toBe(expected);
  });

  it.each([
    'http://example.com',
    'https://example.com',
    'HTTPS://Example.com',
    'ftp://x',
    'javascript:alert(1)',
  ])('leaves an explicit scheme for the API to judge: %s', (input) => {
    expect(normalizeUrlInput(input)).toBe(input);
  });

  it('keeps an empty value empty', () => {
    expect(normalizeUrlInput('   ')).toBe('');
  });
});

describe('localInputToIso', () => {
  it('returns ISO 8601 with a zone for the API', () => {
    expect(localInputToIso('2030-01-02T03:04')).toMatch(/^2030-01-0[12]T\d\d:04:00\.000Z$/);
  });
  it('treats empty or invalid as not given', () => {
    expect(localInputToIso('')).toBeUndefined();
    expect(localInputToIso('nope')).toBeUndefined();
  });
});

describe('labels', () => {
  it('has a Thai label for every link status', () => {
    expect(STATUS_LABELS).toEqual({
      active: 'ใช้งาน',
      expired: 'หมดอายุ',
      disabled: 'ปิด',
      exhausted: 'ครบจำนวน',
    });
  });
  it('maps null stats keys as D-024 says', () => {
    expect(referrerLabel(null)).toBe('เปิดตรง');
    expect(referrerLabel('m.facebook.com')).toBe('m.facebook.com');
    expect(browserLabel(null)).toBe('ไม่ทราบ');
    expect(deviceLabel('mobile')).toBe('มือถือ');
    expect(deviceLabel(null)).toBe('ไม่ทราบ');
    expect(deviceLabel('watch')).toBe('watch');
  });
});

describe('formatting', () => {
  it('formats a calendar day without shifting time zones', () => {
    expect(formatDay('2026-10-03')).toMatch(/^3 ต\.ค\./);
    expect(formatDay('2026-10-31')).toMatch(/^31 ต\.ค\./);
  });

  it('percent is 0 when there is no data', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
  });

  it('relative time', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(formatRelative('2026-10-03T11:59:40Z', now)).toBe('เมื่อสักครู่');
    expect(formatRelative('2026-10-03T11:55:00Z', now)).toMatch(/5 นาที/);
    expect(formatRelative('2026-10-03T09:00:00Z', now)).toMatch(/3 ชั่วโมง/);
  });

  it('truncates the middle of long URLs to the requested length', () => {
    const url = `https://example.com/${'a'.repeat(100)}/end`;
    const out = truncateMiddle(url, 40);
    expect(out).toHaveLength(40);
    expect(out.startsWith('https://example.com/')).toBe(true);
    expect(out.endsWith('/end')).toBe(true);
    expect(truncateMiddle('short', 40)).toBe('short');
  });
});

describe('displayShortUrl (display only; copy/open/QR keep the encoded URL)', () => {
  const COFFEE = '\u0E01\u0E32\u0E41\u0E1F';

  it('decodes a Thai alias and drops the scheme', () => {
    expect(displayShortUrl('https://pl.test/%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F')).toBe(
      `pl.test/${COFFEE}`,
    );
  });

  it('keeps the port and mixed Thai/Latin aliases', () => {
    expect(displayShortUrl('http://localhost:3000/%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F-2026')).toBe(
      `localhost:3000/${COFFEE}-2026`,
    );
  });

  it('leaves Latin codes as they are', () => {
    expect(displayShortUrl('https://pl.test/aw4bh0')).toBe('pl.test/aw4bh0');
    expect(displayShortUrl('https://pl.test/my_link-1')).toBe('pl.test/my_link-1');
  });

  it('shows broken percent-encoding raw instead of throwing', () => {
    expect(displayShortUrl('https://pl.test/%E0%B8')).toBe('pl.test/%E0%B8');
    expect(displayShortUrl('https://pl.test/100%25-%zz')).toBe('pl.test/100%25-%zz');
  });

  it('decodes even when the value is not a full URL', () => {
    expect(displayShortUrl('%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F')).toBe(COFFEE);
    expect(displayShortUrl('%zz')).toBe('%zz');
  });
});

describe('safeDecode', () => {
  it('decodes valid sequences and returns malformed input unchanged', () => {
    expect(safeDecode('%E0%B8%81')).toBe('\u0E01');
    expect(safeDecode('%E0%B8')).toBe('%E0%B8');
    expect(safeDecode('plain')).toBe('plain');
  });
});
