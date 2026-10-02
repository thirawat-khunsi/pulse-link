// Typed client for the /api endpoints (SPEC §5). Types mirror the server DTOs
// (src/modules/links/service.ts, src/modules/stats/service.ts); kept separate so the
// browser bundle never imports server code.

export type LinkStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

export interface Link {
  id: number;
  code: string;
  shortUrl: string;
  targetUrl: string;
  /** Relative path, e.g. `/api/links/1/qr` (D-017). */
  qrUrl: string;
  expiresAt: string | null;
  maxClicks: number | null;
  isActive: boolean;
  createdAt: string;
  clickCount: number;
  qrScanCount: number;
  status: LinkStatus;
}

export interface LinkPage {
  items: Link[];
  nextCursor: string | null;
}

export type StatsDays = 7 | 30;

export interface LinkStats {
  days: StatsDays;
  timeZone: string;
  totals: { clicks: number; qrScans: number; bots: number };
  byDay: { day: string; clicks: number; qrScans: number }[];
  byDevice: { device: string | null; count: number }[];
  byBrowser: { browser: string | null; count: number }[];
  byReferrer: { host: string | null; count: number }[];
  recent: {
    clickedAt: string;
    source: 'click' | 'qr';
    device: string | null;
    browser: string | null;
    os: string | null;
    referrerHost: string | null;
  }[];
}

export interface CreateLinkInput {
  url: string;
  alias?: string;
  expiresAt?: string;
  maxClicks?: number;
}

export interface UpdateLinkInput {
  isActive?: boolean;
  expiresAt?: string | null;
  maxClicks?: number | null;
}

/** Error with the server's Thai message, or a generic one for network/unknown failures. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const NETWORK_ERROR_MESSAGE =
  'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
const UNKNOWN_ERROR_MESSAGE = 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง';

/** Read `{ error: { code, message } }`; anything else becomes a generic Thai message. */
export async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof code === 'string' && typeof message === 'string') {
      return new ApiError(res.status, code, message);
    }
  } catch {
    // not JSON (e.g. a proxy error page)
  }
  return new ApiError(res.status, 'UNKNOWN', UNKNOWN_ERROR_MESSAGE);
}

type Fetch = typeof fetch;

export function createApi(fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method,
        // Same-origin: the pl_owner cookie is sent automatically.
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
    }
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    createLink: (input: CreateLinkInput) => request<Link>('POST', '/api/links', input),
    listLinks: (cursor?: string | null, limit = 20) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      return request<LinkPage>('GET', `/api/links?${query.toString()}`);
    },
    getLink: (id: number) => request<Link>('GET', `/api/links/${id}`),
    updateLink: (id: number, input: UpdateLinkInput) =>
      request<Link>('PATCH', `/api/links/${id}`, input),
    deleteLink: (id: number) => request<undefined>('DELETE', `/api/links/${id}`),
    getStats: (id: number, days: StatsDays) =>
      request<LinkStats>('GET', `/api/links/${id}/stats?days=${days}`),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api = createApi();

/** QR image URL: PNG/SVG, optionally as a file download (SPEC §5). */
export function qrImageUrl(
  link: Pick<Link, 'qrUrl'>,
  options: { format?: 'png' | 'svg'; size?: number; download?: boolean } = {},
): string {
  const query = new URLSearchParams({ format: options.format ?? 'png' });
  if (options.size !== undefined) query.set('size', String(options.size));
  if (options.download) query.set('download', '1');
  return `${link.qrUrl}?${query.toString()}`;
}
