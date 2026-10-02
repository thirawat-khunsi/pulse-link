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
