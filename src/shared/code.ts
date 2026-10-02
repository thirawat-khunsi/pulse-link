import Sqids from 'sqids';

/**
 * Fixed permutation of `0-9a-z` (DECISIONS D-002) so codes of consecutive ids
 * do not look sequential. Changing it changes every generated code — never edit
 * after deployment.
 */
export const CODE_ALPHABET = '41z5vc0e8pihf3duqbnkytj6ar7xs2lw9omg';
export const CODE_MIN_LENGTH = 6;

const sqids = new Sqids({ alphabet: CODE_ALPHABET, minLength: CODE_MIN_LENGTH });

/** Encode a reserved `links.id` into its short code. */
export function encodeId(id: number | bigint): string {
  const n = typeof id === 'bigint' ? Number(id) : id;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`id must be a non-negative safe integer, got ${String(id)}`);
  }
  return sqids.encode([n]);
}

/** Decode a generated code back to its id, or null if it is not a canonical code. */
export function decodeCode(code: string): number | null {
  const ids = sqids.decode(code);
  const [id] = ids;
  if (ids.length !== 1 || id === undefined) return null;
  // Sqids can decode non-canonical strings; only accept the exact encoding.
  return sqids.encode([id]) === code ? id : null;
}
