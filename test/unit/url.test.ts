import { describe, expect, it } from 'vitest';
import {
  MAX_URL_LENGTH,
  URL_REJECTION_MESSAGES,
  isPrivateHost,
  validateTargetUrl,
  type UrlRejection,
} from '../../src/shared/url.js';

const opts = { selfHosts: ['pulse.example.com'] };

function reasonOf(input: string): UrlRejection | 'ok' {
  const r = validateTargetUrl(input, opts);
  return r.ok ? 'ok' : r.reason;
}

describe('validateTargetUrl', () => {
  it('accepts public http and https URLs and returns the normalised href', () => {
    expect(validateTargetUrl('https://example.com', opts)).toEqual({
      ok: true,
      url: 'https://example.com/',
    });
    expect(validateTargetUrl('http://Example.COM/a?b=1#c', opts)).toEqual({
      ok: true,
      url: 'http://example.com/a?b=1#c',
    });
    expect(reasonOf('https://8.8.8.8/dns')).toBe('ok');
    expect(reasonOf('https://[2001:4860:4860::8888]/')).toBe('ok');
  });

  it('accepts internationalised domains and Thai paths', () => {
    const r = validateTargetUrl('https://ไทย.example/กาแฟ', opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe('https://xn--o3cw4h.example/%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F');
  });

  it('rejects URLs longer than 2048 characters', () => {
    const base = 'https://example.com/';
    expect(reasonOf(base + 'a'.repeat(MAX_URL_LENGTH - base.length))).toBe('ok');
    expect(reasonOf(base + 'a'.repeat(MAX_URL_LENGTH - base.length + 1))).toBe('TOO_LONG');
  });

  it('rejects input that new URL cannot parse (including a missing scheme)', () => {
    for (const input of ['', 'not a url', 'example.com', '//example.com', 'http://']) {
      expect(reasonOf(input), input).toBe('INVALID_URL');
    }
  });

  it('rejects schemes other than http and https', () => {
    for (const input of [
      'javascript:alert(1)',
      'ftp://example.com/file',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'mailto:a@example.com',
      'ws://example.com',
    ]) {
      expect(reasonOf(input), input).toBe('UNSUPPORTED_SCHEME');
    }
  });

  it('rejects userinfo', () => {
    expect(reasonOf('https://user:pass@example.com/')).toBe('USERINFO');
    expect(reasonOf('https://user@example.com/')).toBe('USERINFO');
    expect(reasonOf('https://:pass@example.com/')).toBe('USERINFO');
  });

  it('rejects localhost and loopback in any spelling', () => {
    for (const input of [
      'http://localhost/',
      'http://LOCALHOST:3000/',
      'http://localhost./',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://127.1.2.3:8080/',
      'http://0x7f.1/',
      'http://2130706433/',
      'http://017700000001/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://0.0.0.0/',
      'http://[::]/',
    ]) {
      expect(reasonOf(input), input).toBe('PRIVATE_HOST');
    }
  });

  it('rejects private, link-local and other non-public IP literals', () => {
    for (const input of [
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://224.0.0.1/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:10.0.0.1]/',
      'http://[::ffff:192.168.0.1]/',
    ]) {
      expect(reasonOf(input), input).toBe('PRIVATE_HOST');
    }
  });

  it('does not treat public IPs next to private ranges as private', () => {
    for (const input of ['http://172.15.0.1/', 'http://172.32.0.1/', 'http://11.0.0.1/']) {
      expect(reasonOf(input), input).toBe('ok');
    }
  });

  it("rejects the service's own domain (redirect loop)", () => {
    expect(reasonOf('https://pulse.example.com/abc123')).toBe('SELF_HOST');
    expect(reasonOf('http://PULSE.example.com.:8080/x')).toBe('SELF_HOST');
    expect(reasonOf('https://other.example.com/')).toBe('ok');
  });

  it('has a Thai message for every rejection reason', () => {
    for (const message of Object.values(URL_REJECTION_MESSAGES)) {
      expect(message).toMatch(/[฀-๿]/);
    }
  });
});

describe('isPrivateHost', () => {
  it('treats ordinary domain names as public', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('localhost.example.com')).toBe(false);
  });
});
