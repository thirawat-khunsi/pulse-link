# Decisions

บันทึกข้อตัดสินใจที่ SPEC ไม่ได้ระบุชัด หรือที่ต้องเลือกเอง (SPEC §12)

## D-001 บอทกับลิงก์ที่ครบจำนวนคลิก
SPEC: "บอทไม่นับและไม่ถูกจำกัด" — ตีความว่าบอทไม่ทำ atomic UPDATE และไม่กินโควตา `max_clicks`
แต่ถ้าลิงก์ครบจำนวนแล้ว (`click_count >= max_clicks`) บอทก็ได้ 410 เช่นเดียวกับผู้ใช้ เพื่อให้ preview ตรงกับสถานะจริง

## D-002 Alphabet ของ Sqids
ใช้ตัวอักษร `0-9a-z` ครบตาม SPEC แต่สลับลำดับแบบคงที่ใน config เพื่อให้ code ของ id ที่ติดกันดูไม่เรียงกัน
นี่ไม่ใช่มาตรการความปลอดภัย (Sqids decode ได้) short URL ถือเป็นข้อมูลสาธารณะ

## D-003 การนับความยาว alias
นับ 3-32 เป็นจำนวน Unicode code point หลัง normalize NFC (สระ/วรรณยุกต์ไทยนับเป็น 1 ตัว)
ช่วงตัวอักษรไทยที่อนุญาตคือ U+0E00–U+0E7F; ไม่อนุญาตอักขระที่มองไม่เห็น เช่น zero-width space

## D-004 Cache ข้ามโปรเซสเมื่อแยก service
LRU cache อยู่ในหน่วยความจำของแต่ละโปรเซส PATCH/DELETE จะ invalidate ได้เฉพาะโปรเซสที่รับคำขอ
ในโหมดแยก `api` / `redirect` ค่าเก่าจึงค้างได้ไม่เกิน TTL 60 วินาที (ยอมรับเพราะห้ามใช้ Redis)
ลิงก์ที่มี `max_clicks` ไม่ได้รับผลเพราะตัดสินที่ DB ทุกครั้ง; เงื่อนไข atomic UPDATE รวม `expires_at` ด้วย

## D-005 ua-parser-js เวอร์ชัน 1.x
v2 ใช้สัญญาอนุญาต AGPL-3.0 จึงใช้ v1.x (MIT) และตรวจบอทด้วย regex ของเราเอง
(crawler, ตัว preview ของ LINE/Facebook/Slack/Telegram/Discord/WhatsApp/Twitter ฯลฯ)
ระวังไม่จับ LINE in-app browser ซึ่งเป็นผู้ใช้จริง

## D-006 การเสิร์ฟไฟล์ static
Vite build เสิร์ฟผ่าน `@fastify/static` ที่ prefix `/assets/` และ `GET /` ส่ง `index.html` เท่านั้น
ไม่ลงทะเบียน wildcard ที่ root และไม่มี SPA fallback (ใช้ hash routing) เพื่อไม่ให้ชนกับ `/:code`

## D-007 maxParamLength
ค่าเริ่มต้นของ Fastify คือ 100 ตัวอักษร แต่ alias ไทย 32 ตัวเมื่อ percent-encode ยาวได้ ~288 ตัว
จึงตั้ง `maxParamLength` เป็น 512

## D-008 Click buffer เมื่อเกิดข้อผิดพลาด
- flush ล้ม (DB ล่ม): คืนรายการเข้า buffer และลองใหม่รอบถัดไป มีเพดาน 10,000 รายการ เกินแล้วทิ้งรายการเก่าสุดและ log
- โปรเซส crash: อาจเสียคลิกได้ไม่เกินช่วง flush (~1 วินาที) แลกกับ redirect ที่ไม่ต้องรอ DB
- ลิงก์ถูกลบก่อน flush: INSERT ผ่าน `JOIN links` ตัดแถวกำพร้า ไม่ให้ทั้ง batch ล้ม

## D-009 ภาษาของเอกสาร
เอกสารใน `docs/` เขียนภาษาไทยเพื่อผู้ตรวจ ใช้ศัพท์เทคนิคภาษาอังกฤษ; โค้ดและคอมเมนต์เป็นภาษาอังกฤษ
