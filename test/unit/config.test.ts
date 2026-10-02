import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, useSecureCookies } from '../../src/shared/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BASE_URL: 'https://pulse.example.com',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      ...base,
      PORT: 3000,
      APP_MODE: 'all',
      TRUST_PROXY: false,
      CLICK_FLUSH_MS: 1000,
      NODE_ENV: 'development',
    });
  });

  it('coerces numbers and strips a trailing slash from BASE_URL', () => {
    const c = loadConfig({
      ...base,
      BASE_URL: 'https://pulse.example.com/',
      PORT: '8080',
      CLICK_FLUSH_MS: '250',
      APP_MODE: 'redirect',
      NODE_ENV: 'production',
    });
    expect(c.BASE_URL).toBe('https://pulse.example.com');
    expect(c.PORT).toBe(8080);
    expect(c.CLICK_FLUSH_MS).toBe(250);
    expect(c.APP_MODE).toBe('redirect');
    expect(c.NODE_ENV).toBe('production');
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ ...base, PORT: '', APP_MODE: '' }).PORT).toBe(3000);
  });

  it.each([
    ['false', false],
    ['true', true],
    ['TRUE', true],
    ['10.0.0.0/8, 127.0.0.1', ['10.0.0.0/8', '127.0.0.1']],
    ['loopback', ['loopback']],
  ])('parses TRUST_PROXY=%s', (raw, expected) => {
    expect(loadConfig({ ...base, TRUST_PROXY: raw }).TRUST_PROXY).toEqual(expected);
  });

  it.each([
    [{ DATABASE_URL: undefined }, 'DATABASE_URL'],
    [{ DATABASE_URL: 'mysql://x' }, 'DATABASE_URL'],
    [{ BASE_URL: undefined }, 'BASE_URL'],
    [{ BASE_URL: 'ftp://pulse.example.com' }, 'BASE_URL'],
    [{ APP_MODE: 'worker' }, 'APP_MODE'],
    [{ PORT: '70000' }, 'PORT'],
    [{ CLICK_FLUSH_MS: 'soon' }, 'CLICK_FLUSH_MS'],
    [{ TRUST_PROXY: '1' }, 'TRUST_PROXY'],
  ])('rejects invalid env %o', (override, key) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ...override })).toThrow(key);
  });
});

describe('useSecureCookies', () => {
  it.each([
    ['production', 'https://pulse.example.com', true],
    ['production', 'http://localhost:3000', false],
    ['development', 'https://pulse.example.com', false],
    ['test', 'http://localhost:3000', false],
  ] as const)('NODE_ENV=%s BASE_URL=%s → %s', (NODE_ENV, BASE_URL, expected) => {
    expect(useSecureCookies({ NODE_ENV, BASE_URL })).toBe(expected);
  });
});

describe('TRUST_PROXY', () => {
  it('accepts proxy-addr names for private proxy hops', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback, uniquelocal' }).TRUST_PROXY).toEqual([
      'loopback',
      'uniquelocal',
    ]);
  });
});
