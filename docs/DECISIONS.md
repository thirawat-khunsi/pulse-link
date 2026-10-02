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
LRU cache อยู่ในหน่วยความจำของแต่ละโปรเซส POST/PATCH/DELETE จะ invalidate ได้เฉพาะโปรเซสที่รับคำขอ
(POST ล้าง "ไม่พบ" ที่ cache ไว้ของ alias ใหม่ด้วย) ในโหมดแยก `api` / `redirect` จึงค้างได้ดังนี้ (ยอมรับเพราะห้ามใช้ Redis):
- ลิงก์ที่ถูกปิด/ลบ/แก้วันหมดอายุ ยัง redirect ตามค่าเก่าได้ไม่เกิน 60 วินาที
- alias ที่เพิ่งสร้าง อาจยังตอบ 404 ได้ไม่เกิน 10 วินาที ถ้ามีคนเปิดก่อนสร้าง
- ลิงก์ที่มี `max_clicks` ไม่ได้รับผล เพราะตัดสินที่ DB ทุกครั้ง (atomic UPDATE รวม `is_active` และ `expires_at`)
- วันหมดอายุตรวจกับเวลาปัจจุบันทุก request แม้ลิงก์จะอยู่ใน cache (cache เก็บค่า `expires_at` ไม่ได้เก็บผลการตัดสิน)

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

## D-019 ใครนับเป็นบอท (ผู้ใช้ยืนยันแล้ว)
- **บอท** (`is_bot=true`, `device=bot`, ไม่นับใน `clickCount`/`qrScanCount` และไม่กินโควตา `max_clicks`):
  ตัว preview ลิงก์ของแอปแชต/โซเชียล (LINE `line-poker`, Facebook `facebookexternalhit`, Slack, WhatsApp, Telegram, Discord,
  Twitter/X, LinkedIn, Skype), crawler ของ search engine (Googlebot, Bingbot, Baidu, Yandex, DuckDuckGo, Apple, Petal
  และคำทั่วไป `crawler`, `spider`, `...bot`), HeadlessChrome และ request ที่ไม่มี User-Agent
- **คน**: เบราว์เซอร์ทั่วไป รวม in-app browser ของ LINE (`Line/13.x`) และ curl / wget / HTTP library
  (python-requests, Go-http-client ฯลฯ) เพื่อให้การสาธิตด้วย curl ขึ้นในสถิติ
- ข้อยกเว้น: มือถือยี่ห้อ CUBOT ไม่ถือเป็นบอทแม้ลงท้ายด้วย "bot"
- regex อยู่ที่ `src/shared/bot.ts` (ไม่ใช่ `modules/clicks`) เพราะ redirect ต้องรู้ตอน request ว่าจะกินโควตาหรือไม่
  ส่วนการแยก device/browser/os ด้วย ua-parser-js ทำตอน flush ไม่ใช่ใน hot path; LINE in-app ที่ ua-parser-js 1.x
  รายงานเป็น "WebKit" แสดงเป็น "LINE"

## D-020 alias ไทยใน `/:code` และ percent-encoding
- เบราว์เซอร์และแอปสแกน QR ส่ง path ภาษาไทยแบบ percent-encoded เสมอ Fastify ถอดรหัสแล้ว normalize NFC + lowercase
  จึงรองรับทั้ง `/กาแฟ` ที่พิมพ์ในแถบที่อยู่ และ `/%E0%B8%81...` รวมถึงลำดับสระ/วรรณยุกต์ที่ต่างกัน
- ไบต์ UTF-8 ดิบใน request line (ไม่ encode) ถูก HTTP parser ของ Node ปฏิเสธเป็น 400 ก่อนถึงแอป แม้เปิด
  `insecureHTTPParser` ก็ตาม (ตรวจแล้ว) แก้ในแอปไม่ได้และไม่ควรแก้ (RFC 3986 กำหนดให้ encode)
  ถ้าสาธิตด้วย command line ให้ใช้ URL ที่ encode แล้ว (ดู DEMO.md)
- percent-encoding เสีย (`/%E0%B8`, `/%zz`) ตอบหน้า 404 ภาษาไทยเดียวกับกรณีไม่พบ (ผู้ใช้ยืนยันแล้ว) ใต้ `/api` เป็น JSON 404

## D-021 Cache และ shutdown ของ redirect
- Negative cache เป็น LRU แยก 1000 รายการ / 10 วินาที (ผู้ใช้กำหนด) เพื่อไม่ให้การสุ่มเดา code ดันลิงก์จริงออกจาก LRU 5000 รายการ
- `/`, คำสงวน (`api`, `favicon.ico` ฯลฯ) และ code ยาวเกิน 64 ตัว ตอบ 404 ทันทีโดยไม่ query และไม่เก็บลง cache
- `ClickBuffer.close()` รอ DB ได้สูงสุด 5 วินาที (`closeTimeoutMs`) แล้ว log จำนวนคลิกที่เสียและปิดต่อ
  เพื่อไม่ให้ DB ที่ค้างทำให้โปรเซสปิดไม่ได้ (pg ไม่มี query timeout เป็นค่าเริ่มต้น)
- ลำดับปิด: SIGTERM/SIGINT → `app.close()` (onClose: flush buffer) → `db.end()` → `exit(0)`; ถอด signal handler ทันทีที่เริ่มปิด
- 410 ที่เกิดจาก atomic UPDATE ไม่ได้แถว จะอ่านสถานะล่าสุดอีกครั้งเพื่อเลือกข้อความ (ปิด/หมดอายุ/ครบจำนวน)
  ถ้ายังดูใช้งานได้ แปลว่ามีคนอื่นเอาโควตาสุดท้ายไประหว่างนั้น จึงตอบ "ครบจำนวนคลิก"

## D-022 Docker image และการ deploy
- image รันบน `node:24-alpine`: SPEC กำหนด Node 20+ แต่ Node 20 หมดอายุ (EOL) เมษายน 2026 จึงใช้ LTS ปัจจุบัน
  เปลี่ยนได้ด้วย build arg `NODE_IMAGE`; `engines` ยังเป็น `>=20.19` สำหรับเครื่อง dev
- migrate อัตโนมัติใน `CMD` ของ image (`migrate.js && exec node dist/main.js`) แทน service แยกใน compose
  เพื่อให้ free host ที่รันแค่ image เดียวได้พฤติกรรมเดียวกับ `docker compose up`; advisory lock กันการ migrate ซ้อนกัน
  `exec` ทำให้ node เป็น PID 1 และได้รับ SIGTERM โดยตรง (ทดสอบแล้วว่า `docker compose stop` flush คลิกที่ค้างใน buffer)
- cookie `pl_owner` เป็น `Secure` เมื่อ `NODE_ENV=production` **และ** `BASE_URL` เป็น https (SPEC: "Secure เมื่อ production")
  เพราะ compose รัน production ที่ `http://localhost` และเบราว์เซอร์บางตัว (เช่น Safari) ไม่เก็บ Secure cookie บน http
  ซึ่งจะทำให้หน้าประวัติว่างทุกครั้ง; บน host จริง `BASE_URL` เป็น https จึงได้ Secure ตาม SPEC
- `/health` ไม่ตรวจ DB (liveness เท่านั้น) และตั้ง `logLevel: 'warn'` เพราะ healthcheck เรียกทุก 15 วินาทีจะท่วม log
- แนะนำ `TRUST_PROXY=loopback,uniquelocal` บน host ที่ proxy อยู่ในเครือข่ายภายใน แทน `true` ซึ่งทำให้ปลอม
  `X-Forwarded-For` หลบ rate limit ได้ (ทดสอบแล้ว) — รายละเอียดใน DEPLOY.md §4
- Neon ใช้ Direct connection (ไม่ใช่ `-pooler`) เพราะ migration ใช้ session advisory lock ซึ่งใช้กับ PgBouncer
  แบบ transaction pooling ไม่ได้ และใช้ `sslmode=verify-full`

## D-023 QR code (P5)
- เข้ารหัส `${BASE_URL}/${encodeURIComponent(code)}?s=qr` ด้วย error correction M, margin 2 ตาม SPEC; alias ไทยจึงอยู่ใน QR
  แบบ percent-encoded ซึ่งแอปกล้องทุกตัวเปิดได้ (ทดสอบโดยถอดรหัส PNG แล้วยิงเข้า redirect จริง ได้ 302 และ source=qr)
- `format` = `png` (ค่าเริ่มต้น) | `svg`; `size` เป็นจำนวนเต็ม 128-2048 พิกเซล (ค่าเริ่มต้น 512) นอกช่วง → 400;
  `download` ต้องเป็น `1` เท่านั้นจึงส่งเป็นไฟล์ ค่าอื่นแสดงในหน้า
- ชื่อไฟล์: `Content-Disposition: attachment; filename="pulse-link-<id>.<ext>"; filename*=UTF-8''pulse-link-<code>.<ext>`
  (RFC 5987) เบราว์เซอร์ใหม่ได้ชื่อ alias ไทย เบราว์เซอร์เก่าได้ชื่อ ASCII
- `Cache-Control: private, max-age=86400`: ภาพเปลี่ยนเฉพาะเมื่อ `BASE_URL` เปลี่ยน และต้องใช้ cookie ของเจ้าของจึงเป็น private
- SVG ตอบพร้อม `Content-Security-Policy: default-src 'none'` (SVG ของ `qrcode` ไม่มี script อยู่แล้ว กันไว้อีกชั้น)
- ลิงก์ที่ปิด/หมดอายุยังขอ QR ได้ เพราะเจ้าของอาจเปิดใช้ใหม่ (สแกนแล้วได้หน้า 410 ตามสถานะ)
- ตรวจ query ก่อนตรวจความเป็นเจ้าของ: query ผิดได้ 400 แม้ลิงก์ไม่ใช่ของตัวเอง (ไม่เผยว่าลิงก์มีอยู่หรือไม่)
- devDependencies สำหรับ test เท่านั้น (ผู้ใช้อนุมัติ): `jsqr` 1.4.0 (Apache-2.0) ถอดรหัส QR และ `pngjs` ^5.0.0 (MIT)
  อ่าน PNG — ใช้ช่วงเดียวกับที่ `qrcode` ใช้ lockfile จึงมี pngjs ชุดเดียว (5.0.0, deduped); type ของ pngjs เป็น `.d.ts` ใน `test/types`
  `npm audit` (2026-10-03): 0 vulnerabilities ทั้งแบบรวม dev และ `--omit=dev`
- `parseLinkId`, `linkNotFound`, `requireOwnedLink` ย้ายไป `src/shared/ownedLink.ts` เพื่อให้ qr/stats ตรวจเจ้าของได้
  โดยไม่ import โมดูล links (ตาม D-010)

## D-024 สถิติ (P5, ผู้ใช้ยืนยัน totals และ recent)
- `totals` นับ**ตลอดอายุลิงก์** (ผู้ใช้เลือก): `clicks`/`qrScans` ใช้นิยามเดียวกับ `clickCount`/`qrScanCount` (D-018)
  การ์ดใน dashboard จึงตรงกับหน้าประวัติเสมอ; `bots` = แถวที่ `is_bot` ทั้งหมด
- `byDay`, `byDevice`, `byBrowser`, `byReferrer` นับเฉพาะช่วง `days` (7 หรือ 30, ค่าเริ่มต้น 7, ค่าอื่น → 400) และไม่รวมบอท
- ช่วงวัน = วันตามปฏิทิน Asia/Bangkok: "วันนี้" ถึงย้อนหลัง `days - 1` วัน (รวมวันนี้) `byDay` มีครบทุกวันเรียงเก่าไปใหม่
  วันที่ไม่มีคลิกเป็น 0; ขอบเขตเขียนเป็น timestamptz (`clicked_at >= เที่ยงคืนกรุงเทพของวันแรก`) เพื่อใช้ index
- "ตอนนี้" ส่งจาก JS เป็นพารามิเตอร์ ไม่ใช้ `now()` ใน SQL เพื่อให้ test ตรึงเวลาและทดสอบรอยต่อวัน 16:59:59Z / 17:00:00Z ได้
- `recent` = 20 รายการล่าสุดที่ไม่ใช่บอท (ผู้ใช้เลือก) **ไม่จำกัดตามช่วงวัน** เพื่อให้ตารางไม่ว่างเมื่อลิงก์เงียบไปนาน
- `byReferrer` top 10 นับ `null` (ไม่มี Referer: เปิดตรง, แอปแชต, แอปสแกน QR) เป็นหนึ่งรายการ ให้ UI แสดงว่า "เปิดตรง";
  `browser: null` ให้ UI แสดงว่า "ไม่ทราบ"; เมื่อจำนวนเท่ากันเรียงชื่อก่อน `null`
- ผลลัพธ์มี `days` และ `timeZone: "Asia/Bangkok"` เพิ่มจาก SPEC เพื่อให้ UI แสดงช่วงได้ถูก; ตอบ `Cache-Control: no-store`
- สถิติเห็นเฉพาะคลิกที่ flush แล้ว (ช้ากว่าความจริงไม่เกิน `CLICK_FLUSH_MS` ≈ 1 วินาที) dashboard รีเฟรชทุก 5 วินาทีอยู่แล้ว
- test ความสอดคล้อง: ยิงคลิกจริงผ่าน redirect (คน, preview ของ LINE, Googlebot, HEAD, สแกน) ทั้งลิงก์ปกติและลิงก์ที่มี
  `max_clicks` แล้วรายการ, รายละเอียด และ stats ต้องได้ตัวเลขเดียวกัน (4 คลิก / 2 สแกน / 2 บอท) ขณะที่ `links.click_count` = 6

## D-025 Frontend (P6)
- package เดียวกับ server (ไม่มี `web/package.json` แยก): React, Vite, `@fontsource` เป็น **devDependencies**
  เพราะถูก bundle ตอน build แล้ว image ใช้ `npm ci --omit=dev` จึงไม่มีติดไปตอนรัน; `npm install` ครั้งเดียวได้ทั้งระบบ
  dependency ที่เพิ่ม: `react`, `react-dom`, `vite`, `@vitejs/plugin-react` (stack ตาม SPEC §1), `@fontsource/ibm-plex-sans-thai`
  (SPEC §6), `eslint-plugin-react-hooks` (lint กฎของ hooks) และ `@types/react*`; `npm audit` (2026-10-03): 0 vulnerabilities
- กราฟวาดเองด้วย SVG (`web/src/chart.ts` + `components/charts.tsx`) ไม่ใช้ไลบรารีกราฟ: มีแค่เส้น 2 เส้นและแท่ง
  จึงไม่คุ้มที่จะเพิ่ม dependency; SVG วาดตามความกว้างจริงของกล่อง (ResizeObserver) ตัวหนังสือจึงไม่เล็กบนมือถือ
  และมีตารางซ่อน (visually hidden) ให้ screen reader อ่านตัวเลขรายวัน
- ทดสอบ frontend เฉพาะ logic ที่ไม่ผูกกับ DOM (`web/src/*.test.ts`: เติม `https://`, router, เรขาคณิตของกราฟ, api client,
  ป้ายภาษาไทย) ด้วย Vitest ตัวเดิมใน environment node — ไม่เพิ่ม jsdom/Testing Library; ส่วน UI ตรวจด้วยการเปิดจริง
  ใน headless Chrome (สร้างลิงก์ alias ไทย, error จาก API, ประวัติ, dashboard 7/30 วัน, live refresh, QR, ยืนยันลบ, มือถือ 390px)
- ฟอนต์โหลดเฉพาะน้ำหนัก 400/600/700; type ของ API เขียนซ้ำใน `web/src/api.ts` แทนการ import จาก `src/`
  เพื่อไม่ให้ bundle ของเบราว์เซอร์ผูกกับโค้ด server
- Dashboard รีเฟรชทุก 5 วินาทีเฉพาะตอนแท็บมองเห็น (Page Visibility) รอบถัดไปตั้งหลังรอบก่อนเสร็จ (ไม่ซ้อนกัน)
  ถ้ารีเฟรชล้มจะคงข้อมูลเดิมไว้และขึ้นแถบแจ้ง จุด live เปลี่ยนเป็นสีเทา; เปลี่ยน 7/30 วันดึงใหม่ทันที
- การ์ดตัวเลขคลิก/สแกนใช้ `totals` (ตลอดอายุ, D-024) จึงตรงกับหน้าประวัติ; "สัดส่วน" = คลิก : สแกน และแสดงจำนวนบอทที่กรองออก
- วันหมดอายุใช้ `<input type="datetime-local">` ตีความตามเขตเวลาของเครื่องผู้ใช้ แล้วส่งเป็น ISO 8601 (UTC) ให้ API
- prefix ของช่อง alias แสดง host ของหน้าเว็บ (เท่ากับ `BASE_URL` ในโหมด `all`); Short URL จริงมาจาก server เสมอ
- `index.html` อ่านครั้งเดียวตอนเริ่มโปรเซส (build ใหม่ = โปรเซสใหม่) ตอบ `Cache-Control: no-cache`;
  ไฟล์ใน `/assets` มี hash ในชื่อ จึงตอบ `max-age=1 ปี, immutable`; ถ้ายังไม่ได้ build ตอบหน้า 503 ภาษาไทย
- CSP ของ helmet ตัด `upgrade-insecure-requests` เมื่อ `BASE_URL` เป็น http (docker compose ที่ `http://localhost`)
  ไม่เช่นนั้นเบราว์เซอร์จะเปลี่ยน URL ของ asset เป็น https แล้วโหลดไม่ขึ้น; บน https ยังคงไว้
- คัดลอกลิงก์ใช้ Clipboard API ถ้าใช้ไม่ได้ (http ที่ไม่ใช่ localhost) จะเปิด `prompt` ให้คัดลอกเอง
- dev: `npm run dev` (API :3000) + `npm run dev:web` (Vite :5173 proxy `/api` ไป :3000)
