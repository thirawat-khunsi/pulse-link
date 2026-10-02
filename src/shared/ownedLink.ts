import type { Db } from './db.js';
import { AppError } from './errors.js';

export const linkNotFound = () => new AppError(404, 'LINK_NOT_FOUND', 'ไม่พบลิงก์นี้');

/** `:id` path parameter; anything that is not a positive integer can never match a link. */
export function parseLinkId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export interface OwnedLink {
  id: number;
  code: string;
}

/**
 * Ownership check shared by modules that hang off `/api/links/:id` (qr, stats) without importing
 * the links module. Another owner's link is indistinguishable from a missing one (SPEC §4: 404).
 */
export async function findOwnedLink(
  db: Db,
  id: number,
  ownerToken: string,
): Promise<OwnedLink | null> {
  const { rows } = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM links WHERE id = $1 AND owner_token = $2',
    [id, ownerToken],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), code: row.code } : null;
}

/** Resolve the `:id` route param to a link the caller owns, or throw 404 LINK_NOT_FOUND. */
export async function requireOwnedLink(
  db: Db,
  params: unknown,
  ownerToken: string,
): Promise<OwnedLink> {
  const id = parseLinkId((params as { id?: string }).id ?? '');
  const link = id === null ? null : await findOwnedLink(db, id, ownerToken);
  if (!link) throw linkNotFound();
  return link;
}
