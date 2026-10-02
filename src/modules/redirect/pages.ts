import { renderStatusPage } from '../../shared/html.js';
import type { GoneReason } from './resolver.js';

export const GONE_PAGES: Record<GoneReason, string> = {
  disabled: renderStatusPage({
    status: 410,
    title: 'ลิงก์นี้ถูกปิดใช้งาน',
    message: 'เจ้าของลิงก์ปิดการใช้งานลิงก์นี้ไว้ จึงไม่สามารถเปิดได้ในขณะนี้',
  }),
  expired: renderStatusPage({
    status: 410,
    title: 'ลิงก์นี้หมดอายุแล้ว',
    message: 'ลิงก์นี้ตั้งเวลาใช้งานไว้ และเลยกำหนดแล้ว',
  }),
  exhausted: renderStatusPage({
    status: 410,
    title: 'ลิงก์นี้ถูกใช้ครบจำนวนแล้ว',
    message: 'ลิงก์นี้จำกัดจำนวนครั้งที่เปิดได้ และมีผู้เปิดครบตามจำนวนแล้ว',
  }),
};
