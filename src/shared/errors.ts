import type { FastifyError, FastifyInstance } from 'fastify';

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

const INTERNAL_ERROR: ErrorBody = {
  error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' },
};

/** Render every error and unknown route in the `{ error: { code, message } }` shape. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(err.toBody());
    }

    const known = FASTIFY_CLIENT_ERRORS[err.code];
    const status = err.statusCode ?? 500;
    if (known) {
      return reply.status(status).send({ error: known });
    }
    // Invalid JSON surfaces as a SyntaxError with statusCode 400 rather than a FST_ERR_CTP code.
    if (err instanceof SyntaxError && status === 400) {
      return reply.status(400).send({ error: FASTIFY_CLIENT_ERRORS.FST_ERR_CTP_INVALID_JSON_BODY });
    }
    if (status >= 400 && status < 500) {
      return reply
        .status(status)
        .send({ error: { code: 'BAD_REQUEST', message: 'คำขอไม่ถูกต้อง' } });
    }

    request.log.error(err);
    return reply.status(500).send(INTERNAL_ERROR);
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ไม่พบสิ่งที่ต้องการ' } });
  });
}
