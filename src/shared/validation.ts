import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Parse request input with a zod schema, throwing a 400 AppError on failure.
 * Schemas attach Thai messages to their fields; only the first issue is reported.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const [issue] = result.error.issues;
  const message =
    issue?.code === 'unrecognized_keys'
      ? `มีช่องข้อมูลที่ไม่รู้จัก: ${issue.keys.join(', ')}`
      : (issue?.message ?? 'ข้อมูลไม่ถูกต้อง');
  throw new AppError(400, 'VALIDATION_ERROR', message);
}
