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

## D-010 ตำแหน่งของตัวสร้าง code / ตัวตรวจ URL / alias
อยู่ใน `src/shared/` (`code.ts`, `url.ts`, `alias.ts`) แทน `modules/links` เพราะ `redirect` ต้องใช้ `normalizeCode`
ตัวเดียวกับตอนบันทึก alias และโมดูลต้องไม่ import ภายในของกันและกัน

## D-011 ขอบเขตของ "private IP literal" และ "โดเมนของระบบเอง"
- ปฏิเสธ `localhost`, `*.localhost` และ IP literal ในช่วงที่ไม่ใช่สาธารณะ: IPv4 `0/8, 10/8, 100.64/10, 127/8, 169.254/16,
  172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4`; IPv6 `::, ::1, fc00::/7, fe80::/10, ff00::/8`
  และ IPv4-mapped (`::ffff:a.b.c.d`) ตรวจตามช่วง IPv4 — รวม link-local เพื่อกัน `169.254.169.254` (cloud metadata)
- ตรวจเฉพาะ IP literal ไม่ resolve DNS (ตาม SPEC; การ resolve ทำให้ช้าและยังโดน DNS rebinding ได้อยู่ดี)
- รูปแบบ IPv4 แปลกๆ (`0x7f.1`, `2130706433`, `017700000001`) `new URL` normalize เป็น `127.0.0.1` ก่อนตรวจ
- "โดเมนของระบบเอง" = hostname ตรงกับ hostname ของ `BASE_URL` (ไม่สนพอร์ต, ไม่สนตัวพิมพ์, ตัดจุดท้าย) ไม่รวม subdomain
- เก็บ `target_url` เป็น `url.href` ที่ normalize แล้ว (host เป็น punycode, path ถูก percent-encode)

## D-012 code ที่สร้างอัตโนมัติชนคำสงวน
code จาก Sqids ยาว ≥ 6 ตัว `0-9a-z` จึงมีโอกาส (น้อยมาก) ตรงกับ `health`, `assets`, `static` ได้
ตอนสร้างลิงก์ให้ตรวจ `isReservedCode` แล้วจองเลขใหม่ เหมือนกรณีชนกับ alias

## D-013 Node 20 และเวอร์ชันเครื่องมือ
SPEC กำหนด Node 20+ จึงใช้ Vitest 4 (Vitest 5 ต้องการ Node 22+) และ TypeScript 6.0 (typescript-eslint รองรับ < 6.1)
`engines.node` เป็น `>=20.19` ตามที่ ESLint 10 ต้องการ; dev ใช้ `tsx` รันไฟล์ TypeScript โดยไม่ต้อง build
(`npm run dev`, `npm run migrate`) — เป็น devDependency ที่เพิ่มนอก SPEC; `.env` โหลดด้วย `process.loadEnvFile` ของ Node (ไม่ใช้ dotenv)

## D-014 TRUST_PROXY
รับ `false` (ค่าเริ่มต้น), `true` หรือรายการ IP/CIDR ของ proxy คั่นด้วยจุลภาค
ไม่รับจำนวน hop เพราะ Fastify 5 ถือว่า hop count เป็น "ไม่เชื่อใคร" (ตรวจ peer ไม่ได้) ใส่ตัวเลขจะ error ตอนเริ่ม

## D-015 Entrypoint
`src/main.ts` (ใช้กับ `npm start`/`npm run dev`) อ่าน `APP_MODE`; `src/entry/{all,api,redirect}.ts` บังคับโหมดตามชื่อไฟล์
สำหรับรันแต่ละ service แยกกัน (`node dist/entry/redirect.js`)

## D-016 ป้องกัน integration test ล้างฐานข้อมูลจริง
`test/helpers/testDatabase.ts` ตรวจ `TEST_DATABASE_URL` ตอน import ไฟล์ทดสอบ (ก่อนเปิด connection หรือ DROP ใดๆ)
และให้ไฟล์ล้มเหลวทันทีเมื่อ: URL ไม่ใช่ postgres, ชื่อฐานข้อมูลไม่ลงท้ายด้วย `_test`, หรือชี้ไปฐานเดียวกับ `DATABASE_URL`
(เทียบทั้งสตริงตรงตัว และ host + port + ชื่อฐานข้อมูล เพื่อจับกรณีเขียน URL ต่างกันแต่เป็นฐานเดียวกัน)
integration test ทุกไฟล์ที่เพิ่มต่อจากนี้ต้องเรียก `assertSafeTestDatabaseUrl` แบบเดียวกัน

`pulse_link_test` ถูกสร้างโดย `db/init/01-test-db.sql` ซึ่ง Postgres รันเฉพาะตอน volume ยังว่าง
ถ้ามี volume `pgdata` เก่าอยู่ก่อนแล้วให้ `docker compose down -v` หรือสร้างเองด้วย
`docker compose exec postgres createdb -U pulse pulse_link_test`

## D-017 รายละเอียด API ของ /api/links ที่ SPEC ไม่ได้ระบุ
- ทุก endpoint (POST, GET list, GET/PATCH รายการเดียว) คืน object ลิงก์รูปเดียวกัน คือฟิลด์ตาม SPEC
  + `clickCount`, `qrScanCount` และ `status` (`active|disabled|expired|exhausted`) ที่ server คำนวณ
  เพื่อให้ป้ายสถานะในหน้าประวัติไม่ขึ้นกับนาฬิกาเครื่องผู้ใช้ ลำดับความสำคัญ: disabled > expired > exhausted
- `id` เป็น number (BIGINT ที่ยังไม่เกิน `Number.MAX_SAFE_INTEGER`); `:id` ที่ไม่ใช่จำนวนเต็มบวกตอบ 404 เหมือนไม่พบ
- `qrUrl` เป็น path แบบ relative (`/api/links/:id/qr`) เพราะเมื่อแยก service แล้ว `BASE_URL` อาจเป็นโดเมนของ redirect
  ไม่ใช่โดเมนของ API; `shortUrl` = `BASE_URL/encodeURIComponent(code)`
- `expiresAt` ต้องเป็น ISO 8601 ที่มีเขตเวลา และต้องเป็นอนาคตทั้งตอนสร้างและตอน PATCH; PATCH ส่ง `null` = ลบวันหมดอายุ/ลบเพดานคลิก
- ตอนสร้าง ค่า `""`/`null` ของ `alias`, `expiresAt`, `maxClicks` ถือว่าไม่ได้ระบุ (รองรับฟอร์มที่ส่งช่องว่าง)
- body ต้องไม่มีฟิลด์ที่ไม่รู้จัก; PATCH ที่มี `url`/`targetUrl` ตอบ 400 `TARGET_URL_IMMUTABLE`
- cursor = base64url ของ `[created_at::text, id]` (เก็บ microsecond ไว้ครบ) แบ่งหน้าแบบ keyset บน `(created_at, id)`;
  limit ค่าเริ่มต้น 20 สูงสุด 100
- `/api` รับเฉพาะ `application/json` (ปิด parser `text/plain` ของ Fastify) เพื่อไม่ให้ฟอร์มข้ามเว็บส่ง "simple request" เข้ามาได้
- rate limit ของ `POST /api/links` (30/นาที) นับแยกจากโควตารวม 300/นาที ของ route อื่นใต้ `/api`
  (พฤติกรรมของ `@fastify/rate-limit` เมื่อ route ตั้งค่าเอง)

## D-018 `clickCount` / `qrScanCount` นับจากตาราง `clicks` และไม่ซ้อนกัน (ผู้ใช้ยืนยันแล้ว)
- `clickCount` = จำนวนแถวใน `clicks` ที่ `source = 'click' AND NOT is_bot`
- `qrScanCount` = จำนวนแถวใน `clicks` ที่ `source = 'qr' AND NOT is_bot`
- จำนวนเข้าชมรวม = ผลบวกของทั้งสอง ตรงกับเกณฑ์ "นับสแกนแยกจากคลิก" และกราฟแยกเส้นคลิก/สแกนใน stats (P5 ใช้นิยามเดียวกัน)
- `links.click_count` ไม่ถูกใช้แสดงผล มีไว้บังคับ `max_clicks` เท่านั้น (นับทุกการเข้าชมที่ไม่ใช่บอททั้งคลิกและสแกน
  เพราะใช้โควตาร่วมกัน) จึงอาจต่างจากผลนับใน `clicks` ชั่วคราวระหว่างรอ flush หรือเมื่อ flush ทิ้งรายการ (D-008)
- test: คลิก 2 + สแกน 1 + บอท 1 (ทั้งกรณีบอทเป็น click และ qr) ต้องได้ 2 / 1 แม้ `click_count` จะเป็นค่าอื่น
