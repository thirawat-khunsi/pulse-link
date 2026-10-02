import { describe, expect, it } from 'vitest';
import {
  ALIAS_REJECTION_MESSAGES,
  RESERVED_CODES,
  isReservedCode,
  normalizeCode,
  validateAlias,
} from '../../src/shared/alias.js';
import { encodeId } from '../../src/shared/code.js';

describe('normalizeCode', () => {
  it('applies Unicode NFC', () => {
    const decomposed = 'café'; // e + combining acute
    expect(normalizeCode(decomposed)).toBe('café');
    expect(normalizeCode(decomposed)).toBe(normalizeCode('café'));
  });

  it('lowercases Latin letters and leaves Thai untouched', () => {
    expect(normalizeCode('MyLink')).toBe('mylink');
    expect(normalizeCode('กาแฟ')).toBe('กาแฟ');
    expect(normalizeCode('กาแฟ-ABC')).toBe('กาแฟ-abc');
  });

  it('maps a percent-decoded Thai path to the same key as the stored alias', () => {
    const fromUrl = decodeURIComponent(encodeURIComponent('กาแฟ'));
    expect(normalizeCode(fromUrl)).toBe(normalizeCode('กาแฟ'));
  });
});

describe('validateAlias', () => {
  it('accepts the SPEC example /กาแฟ', () => {
    expect(validateAlias('กาแฟ')).toEqual({ ok: true, alias: 'กาแฟ' });
  });

  it('accepts Thai, a-z, 0-9, - and _ (mixed)', () => {
    for (const alias of ['abc', 'my-link_2', 'โปรโมชั่น-2026', 'ร้าน_กาแฟ', '๑๒๓']) {
      expect(validateAlias(alias), alias).toEqual({ ok: true, alias });
    }
  });

  it('returns the normalised alias (NFC + lowercase) so duplicates compare equal', () => {
    expect(validateAlias('Promo-ABC')).toEqual({ ok: true, alias: 'promo-abc' });
    const a = validateAlias('KaFae');
    const b = validateAlias('kafae');
    expect(a).toEqual(b);
  });

  it('counts length in code points after NFC (3-32)', () => {
    expect(validateAlias('ab')).toEqual({ ok: false, reason: 'LENGTH' });
    expect(validateAlias('abc').ok).toBe(true);
    expect(validateAlias('a'.repeat(32)).ok).toBe(true);
    expect(validateAlias('a'.repeat(33))).toEqual({ ok: false, reason: 'LENGTH' });
    // ก + ้ = 2 code points; "ก้า" is 3 code points
    expect(validateAlias('ก้')).toEqual({ ok: false, reason: 'LENGTH' });
    expect(validateAlias('ก้า').ok).toBe(true);
    expect(validateAlias('ก'.repeat(32)).ok).toBe(true);
    expect(validateAlias('ก'.repeat(33))).toEqual({ ok: false, reason: 'LENGTH' });
    expect(validateAlias('')).toEqual({ ok: false, reason: 'LENGTH' });
  });

  it('rejects disallowed characters', () => {
    for (const alias of [
      'has space',
      'slash/es',
      'dot.dot',
      'query?x',
      'hash#x',
      'percent%20',
      'emoji😀x',
      'café',
      'ｆｕｌｌ', // full-width Latin (NFC does not fold it)
      'กา​แฟ', // zero-width space
      '中文字',
      ' abc',
    ]) {
      expect(validateAlias(alias), alias).toEqual({ ok: false, reason: 'CHARACTERS' });
    }
  });

  it('rejects every reserved word, in any case', () => {
    for (const word of RESERVED_CODES) {
      expect(validateAlias(word), word).toEqual({ ok: false, reason: 'RESERVED' });
      expect(validateAlias(word.toUpperCase()), word).toEqual({ ok: false, reason: 'RESERVED' });
    }
  });

  it('has a Thai message for every rejection reason', () => {
    for (const message of Object.values(ALIAS_REJECTION_MESSAGES)) {
      expect(message).toMatch(/[฀-๿]/);
    }
  });
});

describe('isReservedCode', () => {
  it('flags reserved words so generated codes can skip them', () => {
    expect(isReservedCode('health')).toBe(true);
    expect(isReservedCode('Static')).toBe(true);
    expect(isReservedCode(encodeId(1))).toBe(false);
  });
});
