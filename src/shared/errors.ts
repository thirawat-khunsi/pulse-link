import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NOT_FOUND_PAGE, renderStatusPage, sendHtml } from './html.js';

/**
 * Application error rendered as `{ error: { code, message } }`.
 * `message` is user-facing and therefore in Thai.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export interface ErrorBody {
  error: { code: string; message: string };
}

// Fastify's own client errors (body parsing, media type, size) mapped to stable codes and Thai messages.
const FASTIFY_CLIENT_ERRORS: Record<string, { code: string; message: string }> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'รองรับเฉพาะข้อมูลแบบ application/json',
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: { code: 'INVALID_BODY', message: 'ไม่พบข้อมูลที่ส่งมา' },
  FST_ERR_CTP_INVALID_JSON_BODY: { code: 'INVALID_BODY', message: 'รูปแบบ JSON ไม่ถูกต้อง' },
  FST_ERR_CTP_BODY_TOO_LARGE: { code: 'BODY_TOO_LARGE', message: 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป' },
};

const BAD_REQUEST = { code: 'BAD_REQUEST', message: 'คำขอไม่ถูกต้อง' };
const NOT_FOUND = { code: 'NOT_FOUND', message: 'ไม่พบสิ่งที่ต้องการ' };
const INTERNAL_ERROR = {
  code: 'INTERNAL_ERROR',
  message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

/** JSON for /api; everything else is a short link (or a browser) and gets a Thai HTML page. */
function isApiPath(url: string): boolean {
  return url === '/api' || /^\/api[/?]/.test(url);
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  error: { code: string; message: string },
): FastifyReply {
  if (isApiPath(request.url)) return reply.status(status).send({ error });
  const html =
    status === 404
      ? NOT_FOUND_PAGE
      : renderStatusPage({ status, title: 'เกิดข้อผิดพลาด', message: error.message });
  return sendHtml(reply, status, html);
}

/**
 * Fastify `frameworkErrors`: errors raised before routing. A malformed percent-encoding
 * (`/%E0%B8`) is treated exactly like an unknown link; Fastify's own message never leaks.
 */
export function handleFrameworkError(
  err: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err.code === 'FST_ERR_BAD_URL') void sendError(request, reply, 404, NOT_FOUND);
  else void sendError(request, reply, 400, BAD_REQUEST);
}

/** Render every error and unknown route: JSON `{ error }` under /api, Thai HTML elsewhere. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return sendError(request, reply, err.statusCode, err.toBody().error);
    }

    const known = FASTIFY_CLIENT_ERRORS[err.code];
    const status = err.statusCode ?? 500;
    if (known) return sendError(request, reply, status, known);
    // Invalid JSON surfaces as a SyntaxError with statusCode 400 rather than a FST_ERR_CTP code.
    if (err instanceof SyntaxError && status === 400) {
      return sendError(request, reply, 400, {
        code: 'INVALID_BODY',
        message: 'รูปแบบ JSON ไม่ถูกต้อง',
      });
    }
    if (status >= 400 && status < 500) return sendError(request, reply, status, BAD_REQUEST);

    request.log.error(err);
    return sendError(request, reply, 500, INTERNAL_ERROR);
  });

  app.setNotFoundHandler((request, reply) => sendError(request, reply, 404, NOT_FOUND));
}
