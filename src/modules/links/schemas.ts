import { z } from 'zod';

/** Upper bound of a Postgres INTEGER column. */
const MAX_INT = 2_147_483_647;
export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;

const BODY_NOT_OBJECT = 'ข้อมูลที่ส่งมาต้องเป็น JSON object';
const MAX_CLICKS_INVALID = `จำนวนคลิกสูงสุดต้องเป็นจำนวนเต็ม 1-${MAX_INT}`;
const LIMIT_INVALID = `limit ต้องเป็นจำนวนเต็ม 1-${LIST_MAX_LIMIT}`;
const CURSOR_INVALID = 'cursor ไม่ถูกต้อง';

const expiresAt = z.iso
  .datetime({ offset: true, error: 'วันหมดอายุต้องเป็นวันเวลารูปแบบ ISO 8601 พร้อมเขตเวลา' })
  .transform((v) => new Date(v));

const maxClicks = z
  .int({ error: MAX_CLICKS_INVALID })
  .min(1, { error: MAX_CLICKS_INVALID })
  .max(MAX_INT, { error: MAX_CLICKS_INVALID });

/** Treat `""` and `null` from form inputs as "not given". */
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const createLinkBody = z.strictObject(
  {
    url: z
      .string({ error: 'กรุณาระบุ URL ปลายทาง' })
      .trim()
      .min(1, { error: 'กรุณาระบุ URL ปลายทาง' }),
    alias: z.preprocess(
      emptyToUndefined,
      z.string({ error: 'ชื่อลิงก์ต้องเป็นข้อความ' }).trim().optional(),
    ),
    expiresAt: z.preprocess(emptyToUndefined, expiresAt.optional()),
    maxClicks: z.preprocess(emptyToUndefined, maxClicks.optional()),
  },
  { error: BODY_NOT_OBJECT },
);
export type CreateLinkInput = z.output<typeof createLinkBody>;

export const updateLinkBody = z
  .strictObject(
    {
      isActive: z.boolean({ error: 'สถานะการใช้งานต้องเป็น true หรือ false' }).optional(),
      // null clears the limit/expiry.
      expiresAt: expiresAt.nullable().optional(),
      maxClicks: maxClicks.nullable().optional(),
    },
    { error: BODY_NOT_OBJECT },
  )
  .refine((v) => Object.keys(v).length > 0, { error: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });
export type UpdateLinkInput = z.output<typeof updateLinkBody>;

export const listLinksQuery = z.object({
  limit: z.coerce
    .number({ error: LIMIT_INVALID })
    .int({ error: LIMIT_INVALID })
    .min(1, { error: LIMIT_INVALID })
    .max(LIST_MAX_LIMIT, { error: LIMIT_INVALID })
    .default(LIST_DEFAULT_LIMIT),
  cursor: z.string({ error: CURSOR_INVALID }).min(1, { error: CURSOR_INVALID }).optional(),
});
