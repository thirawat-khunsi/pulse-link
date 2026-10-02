import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_MIN_LENGTH, decodeCode, encodeId } from '../../src/shared/code.js';

describe('code generator (Sqids)', () => {
  it('uses a permutation of exactly 0-9a-z', () => {
    expect(Array.from(CODE_ALPHABET).sort().join('')).toBe('0123456789abcdefghijklmnopqrstuvwxyz');
  });

  it('produces unique, lowercase, >= 6 char codes for many ids', () => {
    const seen = new Set<string>();
    for (let id = 1; id <= 20_000; id++) {
      const code = encodeId(id);
      expect(code).toMatch(/^[0-9a-z]+$/);
      expect(code.length).toBeGreaterThanOrEqual(CODE_MIN_LENGTH);
      seen.add(code);
    }
    expect(seen.size).toBe(20_000);
  });

  it('is deterministic and round-trips through decode', () => {
    for (const id of [1, 2, 42, 999_999, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
      const code = encodeId(id);
      expect(encodeId(id)).toBe(code);
      expect(decodeCode(code)).toBe(id);
    }
  });

  it('accepts bigint ids (pg returns BIGSERIAL as string/bigint)', () => {
    expect(encodeId(123n)).toBe(encodeId(123));
  });

  it('does not make consecutive ids look sequential', () => {
    const a = encodeId(1000);
    const b = encodeId(1001);
    // Shared prefix should be short; a counter-like code would share almost everything.
    let common = 0;
    while (common < a.length && a[common] === b[common]) common++;
    expect(common).toBeLessThan(a.length - 1);
  });

  it('rejects invalid ids', () => {
    expect(() => encodeId(-1)).toThrow(RangeError);
    expect(() => encodeId(1.5)).toThrow(RangeError);
    expect(() => encodeId(2n ** 64n)).toThrow(RangeError);
  });

  it('decodeCode returns null for non-canonical input', () => {
    expect(decodeCode('กาแฟ')).toBeNull();
    expect(decodeCode('')).toBeNull();
    expect(decodeCode(encodeId(7).toUpperCase())).toBeNull();
  });
});
