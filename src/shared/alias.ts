export const ALIAS_MIN_LENGTH = 3;
export const ALIAS_MAX_LENGTH = 32;

/** Paths owned by the app itself; a link with one of these codes would be shadowed or confusing. */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'api',
  'health',
  'assets',
  'favicon.ico',
  'robots.txt',
  'admin',
  'app',
  'static',
]);

// Thai block U+0E00–U+0E7F, Latin lowercase, digits, '-' and '_' (DECISIONS D-003).
const ALIAS_PATTERN = /^[฀-๿a-z0-9_-]+$/u;

export type AliasRejection = 'LENGTH' | 'CHARACTERS' | 'RESERVED';

export type AliasValidation = { ok: true; alias: string } | { ok: false; reason: AliasRejection };

/** User-facing (Thai) messages for each rejection reason. */
export const ALIAS_REJECTION_MESSAGES: Record<AliasRejection, string> = {
  LENGTH: `ชื่อลิงก์ต้องยาว ${ALIAS_MIN_LENGTH}-${ALIAS_MAX_LENGTH} ตัวอักษร`,
  CHARACTERS: 'ชื่อลิงก์ใช้ได้เฉพาะตัวอักษรไทย a-z 0-9 - และ _',
  RESERVED: 'ชื่อลิงก์นี้เป็นคำสงวนของระบบ',
};

/**
 * Canonical form of a code/alias: Unicode NFC, Latin letters lowercased.
 * Used both when storing an alias and when resolving `/:code`, so they always match.
 */
export function normalizeCode(input: string): string {
  return input.normalize('NFC').toLowerCase();
}

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(normalizeCode(code));
}

/** Normalise and validate a user-supplied alias (SPEC §4). Uniqueness is enforced by the DB. */
export function validateAlias(input: string): AliasValidation {
  const alias = normalizeCode(input);
  // Length in code points after NFC (Thai vowels/tone marks count as one each).
  const length = Array.from(alias).length;
  if (length < ALIAS_MIN_LENGTH || length > ALIAS_MAX_LENGTH) {
    return { ok: false, reason: 'LENGTH' };
  }
  if (RESERVED_CODES.has(alias)) return { ok: false, reason: 'RESERVED' };
  if (!ALIAS_PATTERN.test(alias)) return { ok: false, reason: 'CHARACTERS' };
  return { ok: true, alias };
}
