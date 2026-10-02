import { ALIAS_REJECTION_MESSAGES, isReservedCode, validateAlias } from '../../shared/alias.js';
import { encodeId } from '../../shared/code.js';
import { AppError } from '../../shared/errors.js';
import { linkNotFound } from '../../shared/ownedLink.js';
import { URL_REJECTION_MESSAGES, validateTargetUrl } from '../../shared/url.js';
import type { LinkPatch, LinkRepository, LinkRow, ListCursor } from './repository.js';
import type { CreateLinkInput, UpdateLinkInput } from './schemas.js';

/** How many fresh ids to try when a generated code collides with an alias or reserved word. */
const MAX_CODE_ATTEMPTS = 5;

export type LinkStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

export interface LinkDto {
  id: number;
  code: string;
  shortUrl: string;
  targetUrl: string;
  qrUrl: string;
  expiresAt: string | null;
  maxClicks: number | null;
  isActive: boolean;
  createdAt: string;
  /** Non-bot rows in `clicks` with source=click (QR scans excluded, see DECISIONS D-018). */
  clickCount: number;
  /** Non-bot rows in `clicks` with source=qr. */
  qrScanCount: number;
  status: LinkStatus;
}

export interface LinkServiceOptions {
  /** Public origin without trailing slash, e.g. `https://pulse.example.com`. */
  baseUrl: string;
  /**
   * Called with a link's code after it is created, updated or deleted, so the redirect cache
   * of this process drops it (including a cached miss for a new alias).
   */
  onLinkChanged?: (code: string) => void;
}

function isCodeConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' && e.constraint === 'links_code_key';
}

function assertFuture(expiresAt: Date | null | undefined, now: Date): void {
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'วันหมดอายุต้องเป็นเวลาในอนาคต');
  }
}

export function linkStatus(row: LinkRow, now: Date): LinkStatus {
  if (!row.is_active) return 'disabled';
  if (row.expires_at && row.expires_at.getTime() <= now.getTime()) return 'expired';
  if (row.max_clicks !== null && row.click_count >= row.max_clicks) return 'exhausted';
  return 'active';
}

export function encodeCursor(row: LinkRow): string {
  return Buffer.from(JSON.stringify([row.created_at_text, Number(row.id)])).toString('base64url');
}

export function decodeCursor(raw: string): ListCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      !Number.isNaN(Date.parse(value[0])) &&
      Number.isSafeInteger(value[1])
    ) {
      return { createdAt: value[0], id: value[1] as number };
    }
  } catch {
    // fall through
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'cursor ไม่ถูกต้อง');
}

export function createLinkService(repo: LinkRepository, options: LinkServiceOptions) {
  const selfHosts = [new URL(options.baseUrl).hostname];

  function toDto(row: LinkRow, now = new Date()): LinkDto {
    const id = Number(row.id);
    return {
      id,
      code: row.code,
      shortUrl: `${options.baseUrl}/${encodeURIComponent(row.code)}`,
      targetUrl: row.target_url,
      // Relative: in split deployments BASE_URL may be the redirect host, not the API host.
      qrUrl: `/api/links/${id}/qr`,
      expiresAt: row.expires_at?.toISOString() ?? null,
      maxClicks: row.max_clicks,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      clickCount: Number(row.click_total),
      qrScanCount: Number(row.qr_scan_count),
      status: linkStatus(row, now),
    };
  }

  function changed(row: LinkRow): LinkRow {
    options.onLinkChanged?.(row.code);
    return row;
  }

  async function insertGenerated(
    base: Omit<Parameters<LinkRepository['insert']>[0], 'id' | 'code'>,
  ) {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const id = await repo.reserveId();
      const code = encodeId(id);
      if (isReservedCode(code)) continue;
      try {
        return await repo.insert({ ...base, id, code });
      } catch (err) {
        // An alias already took this code; burn the id and try the next one.
        if (!isCodeConflict(err)) throw err;
      }
    }
    throw new Error(`could not generate a free code after ${MAX_CODE_ATTEMPTS} attempts`);
  }

  return {
    toDto,

    async create(ownerToken: string, input: CreateLinkInput): Promise<LinkDto> {
      const url = validateTargetUrl(input.url, { selfHosts });
      if (!url.ok) throw new AppError(400, 'INVALID_URL', URL_REJECTION_MESSAGES[url.reason]);
      assertFuture(input.expiresAt, new Date());

      const base = {
        ownerToken,
        isCustomAlias: false,
        targetUrl: url.url,
        expiresAt: input.expiresAt ?? null,
        maxClicks: input.maxClicks ?? null,
      };

      if (input.alias === undefined) return toDto(changed(await insertGenerated(base)));

      const alias = validateAlias(input.alias);
      if (!alias.ok) {
        throw new AppError(400, 'INVALID_ALIAS', ALIAS_REJECTION_MESSAGES[alias.reason]);
      }
      try {
        const row = await repo.insert({ ...base, code: alias.alias, isCustomAlias: true });
        return toDto(changed(row));
      } catch (err) {
        if (isCodeConflict(err)) {
          throw new AppError(409, 'ALIAS_TAKEN', 'ชื่อลิงก์นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');
        }
        throw err;
      }
    },

    async list(ownerToken: string, limit: number, cursor: string | undefined) {
      const rows = await repo.listByOwner(
        ownerToken,
        limit + 1,
        cursor ? decodeCursor(cursor) : null,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const now = new Date();
      return {
        items: page.map((row) => toDto(row, now)),
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    },

    async get(ownerToken: string, id: number): Promise<LinkDto> {
      const row = await repo.findForOwner(id, ownerToken);
      if (!row) throw linkNotFound();
      return toDto(row);
    },

    async update(ownerToken: string, id: number, input: UpdateLinkInput): Promise<LinkDto> {
      assertFuture(input.expiresAt, new Date());
      const patch: LinkPatch = input;
      const row = await repo.updateForOwner(id, ownerToken, patch);
      if (!row) throw linkNotFound();
      return toDto(changed(row));
    },

    async remove(ownerToken: string, id: number): Promise<void> {
      const code = await repo.deleteForOwner(id, ownerToken);
      if (code === null) throw linkNotFound();
      options.onLinkChanged?.(code);
    },
  };
}

export type LinkService = ReturnType<typeof createLinkService>;
