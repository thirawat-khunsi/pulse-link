# Pulse Link — ระบบ Short URL (SPEC)

## 0. บริบท
แบบทดสอบ Developer: ออกแบบและพัฒนาระบบ Short URL มีเวลาทำจริง 2 วัน
ข้อบังคับของโจทย์: ใช้ Node.js (หรือ PHP framework / Vue / React), push ขึ้น Git, เชื่อมต่อฐานข้อมูลจริง,
เข้าใช้งานผ่าน URL ออนไลน์ได้ (free host), README ต้องบอกวิธีติดตั้งละเอียด,
ส่ง Architecture Diagram (จะพิจารณาเป็นพิเศษถ้าทำเป็น microservice ได้)
เกณฑ์ตรวจ: (1) DFD Level 0 (2) ER Diagram (3) กรอก URL แล้วสร้าง Short URL และคลิกไปปลายทางได้จริง
(4) สร้าง QR Code ของ Short URL ที่สแกนแล้วเปิดปลายทางได้จริง (5) เก็บประวัติ แสดงรายการ URL/Short URL และสถิติการคลิก
(6) ฟังก์ชัน/ไอเดียเพิ่มเติมที่มีประโยชน์ (พิจารณาเป็นพิเศษ)
แนวคิดผลิตภัณฑ์: "Pulse Link" คือ Smart Link ที่ดูชีพจรของลิงก์ได้แบบเรียลไทม์

## 1. Stack และข้อจำกัด
- Node.js 20+, TypeScript (strict), Fastify, PostgreSQL (driver: pg), zod, Sqids (`sqids`), `qrcode`, `ua-parser-js`,
  `@fastify/static`, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/cookie`
- Frontend: React + Vite + TypeScript อยู่ใน `web/` build แล้วให้ Fastify เสิร์ฟเป็นไฟล์ static (host เดียว) ใช้ hash routing
- Test: Vitest (ใช้ `fastify.inject`), DB ทดสอบแยกจาก DB หลัก
- Migration: ไฟล์ SQL ธรรมดาใน `db/migrations/` + สคริปต์ runner เล็กๆ (ไม่ใช้ ORM)
- ห้ามเพิ่ม dependency นอกเหนือนี้โดยไม่บอกเหตุผล ไม่ใช้ Redis ไม่ใช้ระบบ login

## 2. สถาปัตยกรรม (modular monolith พร้อมแยกเป็น microservice)
- โค้ดเดียว แบ่งโมดูลชัด: `src/modules/{links,redirect,clicks,qr,stats}`, `src/shared`, `src/entry/{all,api,redirect}.ts`
- ตัวแปร `APP_MODE`: `all` (ค่าเริ่มต้น) | `api` (/api + static + /health) | `redirect` (/:code + /health เท่านั้น)
  ทั้งสองโหมดใช้ DB เดียวกันและรันแยกโปรเซสได้ นี่คือจุดที่ใช้อธิบายความเป็น microservice
- Redirect เป็น hot path: LRU cache ในหน่วยความจำ (สูงสุด 5000 รายการ, TTL 60 วินาที, negative cache 10 วินาที)
- การบันทึกคลิกต้องไม่หน่วง redirect: เก็บลง buffer ในหน่วยความจำ แล้ว flush แบบ batch ทุก `CLICK_FLUSH_MS` (ค่าเริ่มต้น 1000)
  หรือเมื่อครบ 100 รายการ และ flush ให้หมดตอน graceful shutdown
- ใช้ HTTP 302 เท่านั้น (301 จะถูก browser cache ทำให้นับคลิกไม่ได้) ตั้ง `Cache-Control: no-store`

## 3. Database (PostgreSQL)
```sql
CREATE TABLE links (
  id BIGSERIAL PRIMARY KEY,
  owner_token UUID NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  is_custom_alias BOOLEAN NOT NULL DEFAULT FALSE,
  target_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  max_clicks INTEGER CHECK (max_clicks > 0),
  click_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_links_owner ON links(owner_token, created_at DESC);

CREATE TABLE clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source VARCHAR(8) NOT NULL DEFAULT 'click' CHECK (source IN ('click','qr')),
  device VARCHAR(16),
  browser VARCHAR(64),
  os VARCHAR(64),
  referrer_host VARCHAR(255),
  is_bot BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_clicks_link_time ON clicks(link_id, clicked_at DESC);
```
`click_count` นับเฉพาะคลิกที่ไม่ใช่บอท `device` ∈ mobile|tablet|desktop|bot|unknown

## 4. กฎทางธุรกิจ
**การสร้าง code**
- สร้างจาก Sqids: alphabet เฉพาะ `0-9a-z` (ตัวพิมพ์เล็กล้วน), minLength 6, ใช้ค่า id จาก `nextval` ของ sequence ของ links.id
  (จองเลขก่อน แล้ว INSERT พร้อม id นั้น) ถ้าชนกับ alias ที่มีอยู่ ให้จองเลขใหม่แล้วลองใหม่
- Alias กำหนดเองได้: ความยาว 3-32, อนุญาตตัวอักษรไทย, a-z, 0-9, `-`, `_` ผ่านการ normalize เป็น Unicode NFC และแปลงตัวละตินเป็นตัวพิมพ์เล็ก
  ห้ามซ้ำ (409) และห้ามใช้คำสงวน: api, health, assets, favicon.ico, robots.txt, admin, app, static
- ตัวอย่างที่ต้องใช้ได้: `/กาแฟ`

**การตรวจ URL ปลายทาง**
- รับเฉพาะ `http:` และ `https:`, ยาวไม่เกิน 2048, ต้อง parse ด้วย `new URL` ได้
- ปฏิเสธ: มี userinfo (user:pass@), host เป็น localhost/loopback/private IP literal, host ตรงกับโดเมนของระบบเอง (กัน redirect วนลูป)
- ถ้าผู้ใช้กรอกไม่มี scheme ให้ UI เติม `https://` ให้ แต่ API ต้องเข้มงวดตามกฎข้างบน

**การ redirect `GET /:code`**
1. ดึงพารามิเตอร์ ถอดรหัส percent-encoding แล้ว normalize NFC (+ lowercase ตัวละติน)
2. หา link จาก cache → DB
3. ไม่พบ → 404 หน้า HTML ภาษาไทย; `is_active=false`, หมดอายุ (`expires_at` < now) หรือครบ `max_clicks` → 410 หน้า HTML ภาษาไทย (escape ข้อมูลทุกจุด)
4. พบ → ตอบ 302 ไปยัง target_url
5. หลังตอบ: บันทึกคลิก (ผ่าน buffer) ยกเว้นเมื่อ method เป็น HEAD
   - `source` = `qr` ถ้ามี query `s=qr` ไม่เช่นนั้น `click`
   - แยก device/browser/os ด้วย ua-parser-js, ตรวจบอท (เช่นตัว preview ของโปรแกรมแชต/crawler) → `is_bot=true`
   - `referrer_host` เก็บเฉพาะ hostname จากหัว Referer
- ลิงก์ที่ตั้ง `max_clicks`: ห้ามใช้ cache ในการตัดสิน ให้ใช้คำสั่งเดียวแบบ atomic
  `UPDATE links SET click_count=click_count+1 WHERE id=$1 AND is_active AND (max_clicks IS NULL OR click_count<max_clicks) RETURNING ...`
  ถ้าไม่ได้แถวกลับมา → 410 (บอทไม่นับและไม่ถูกจำกัด)
- ลิงก์ที่ไม่ตั้ง max_clicks: เพิ่ม click_count ตอน flush แบบ batch

**ความเป็นเจ้าของ (ไม่มี login)**
- Cookie `pl_owner` (UUID, httpOnly, SameSite=Lax, Secure เมื่อ production, อายุ 1 ปี) ออกให้เมื่อเรียก /api ครั้งแรก
- ทุก endpoint ใต้ /api/links เห็นและแก้ได้เฉพาะลิงก์ที่ owner_token ตรงกับ cookie (ไม่ตรง → 404)

## 5. API (ทุก response เป็น JSON ยกเว้นระบุ, error รูปแบบ `{ "error": { "code": "...", "message": "ภาษาไทย" } }`)
- `GET /health` → `{ ok: true, mode }`
- `POST /api/links` body `{ url, alias?, expiresAt?, maxClicks? }` → 201 `{ id, code, shortUrl, targetUrl, qrUrl, expiresAt, maxClicks, isActive, createdAt }`
- `GET /api/links?limit=20&cursor=` → `{ items: [{ ...link, clickCount, qrScanCount }], nextCursor }` เรียงใหม่สุดก่อน
- `GET /api/links/:id` → รายละเอียดลิงก์
- `PATCH /api/links/:id` body `{ isActive?, expiresAt?, maxClicks? }` (แก้ target_url ไม่ได้)
- `DELETE /api/links/:id` → 204
- `GET /api/links/:id/stats?days=7|30` → `{ totals: { clicks, qrScans, bots }, byDay: [{ day, clicks, qrScans }], byDevice: [...], byBrowser: [...], byReferrer: [...top 10], recent: [...20 รายการล่าสุด] }`
  จัดกลุ่มวันตามเขตเวลา Asia/Bangkok, `byDay` ต้องมีทุกวันในช่วง (วันที่ไม่มีคลิกเป็น 0), สถิติไม่รวมบอท (แสดงจำนวนบอทแยกใน totals.bots)
- `GET /api/links/:id/qr?format=png|svg&size=512&download=1` → รูปภาพ; QR เข้ารหัส `${BASE_URL}/${encodeURIComponent(code)}?s=qr`
  (ใช้ error correction ระดับ M, margin 2) ถ้า download=1 ให้ส่ง Content-Disposition เป็นไฟล์ดาวน์โหลด

## 6. Frontend (ภาษาไทยทั้งหมด)
ทิศทางดีไซน์ "Pulse" ให้มีเอกลักษณ์ ไม่ใช่เทมเพลตทั่วไป (ถ้ามี skill frontend-design ให้ใช้ ถ้าไม่มีให้ยึดทิศทางนี้):
พื้นหลังหมึกน้ำเงินเข้ม (~#0B1020), สีเน้นหลักเขียวมิ้นต์สว่าง (~#3DF5A7) สำหรับ "คลิก", สีรอง coral (~#FF5C7A) สำหรับ "สแกน QR",
ลวดลายเส้นคลื่นชีพจร (ECG) ที่ header และจุด live ที่กะพริบ, ฟอนต์ไทยแบบ self-host ผ่าน `@fontsource` (เช่น IBM Plex Sans Thai) ไม่ใช้ CDN
ต้อง responsive ใช้งานบนมือถือได้ดี มีสถานะ loading/empty/error ครบ

หน้าจอ (hash routing):
1. `#/` สร้างลิงก์: ช่อง URL, alias (ตัวเลือกขั้นสูงพับเก็บ), วันหมดอายุ, จำกัดคลิก → เมื่อสำเร็จแสดงการ์ดผลลัพธ์ (Short URL + ปุ่มคัดลอก + QR + ปุ่มดาวน์โหลด PNG/SVG + ปุ่มเปิดลิงก์)
2. `#/history` ประวัติ: รายการ URL ต้นฉบับ (ตัดข้อความ), Short URL, วันที่สร้าง, จำนวนคลิก, จำนวนสแกน, ป้ายสถานะ (ใช้งาน/หมดอายุ/ปิด/ครบจำนวน), ปุ่ม คัดลอก/เปิด/QR/สถิติ/เปิด-ปิด/ลบ (ยืนยันก่อนลบ)
3. `#/links/:id` Pulse Dashboard: การ์ดตัวเลข (คลิก, สแกน, สัดส่วน), กราฟเส้นรายวันแยกคลิก/สแกน (เลือก 7/30 วัน), อุปกรณ์, เบราว์เซอร์, referrer, ตารางคลิกล่าสุด
   รีเฟรชอัตโนมัติทุก 5 วินาทีเมื่อแท็บเปิดอยู่ พร้อมจุด live

## 7. ความปลอดภัยและคุณภาพ
- Rate limit: POST /api/links 30 ครั้ง/นาที/IP, /api ทั้งหมด 300 ครั้ง/นาที/IP; รองรับ `TRUST_PROXY`
- helmet, CORS ปิด (same-origin), validate ทุก input ด้วย zod, SQL ใช้ parameterized เท่านั้น, escape HTML ทุกหน้าที่ server เรนเดอร์
- Config ผ่าน env เท่านั้น: `DATABASE_URL, BASE_URL, PORT, APP_MODE, TRUST_PROXY, CLICK_FLUSH_MS, NODE_ENV` พร้อม `.env.example`
- ไม่ commit secret, มี `.gitignore` ครบ

## 8. การทดสอบ (ขั้นต่ำ)
ตัวสร้าง code (ไม่ซ้ำ/ตัวพิมพ์เล็ก/ยาวอย่างน้อย 6), ตัวตรวจ URL (กรณีปฏิเสธทั้งหมดข้างบน), alias ไทย (NFC, ซ้ำ, คำสงวน),
redirect (302, 404, 410 กรณีหมดอายุ/ปิด/ครบจำนวน, ไม่หน่วงเพราะบันทึกคลิก, HEAD ไม่นับ), source=qr, การแยกบอท,
สิทธิ์ความเป็นเจ้าของ (ลิงก์ของคนอื่นต้อง 404), stats (วันที่ว่างเป็น 0, เขตเวลา Bangkok), QR (ถอดรหัสได้ URL ที่ถูกต้อง)

## 9. สิ่งที่ต้องส่งมอบ
- โค้ดครบ พร้อม `Dockerfile` (multi-stage) และ `docker-compose.yml` (app + postgres) รัน `docker compose up` แล้วใช้งานได้
- สคริปต์: `npm run dev | build | start | test | lint | typecheck | migrate | seed` (`seed` สร้างลิงก์ตัวอย่างพร้อมคลิกย้อนหลัง 14 วัน เพื่อใช้สาธิต dashboard)
- `docs/ARCHITECTURE.md` (Mermaid: ภาพรวม + โหมด all/api/redirect + flow การ redirect และบันทึกคลิก),
  `docs/DFD.md` (DFD Level 0 และ Level 1 เป็น Mermaid), `docs/ER.md` (ER Diagram ตรงกับ migration จริง),
  `docs/DEPLOY.md` (ขั้นตอน deploy ตัวอย่างบน free host + Postgres ภายนอก), `docs/DEMO.md` (สคริปต์สาธิต 30 นาทีเรียงตามเกณฑ์ 1-6 + คำถามที่น่าจะถูกถามพร้อมคำตอบ)
- `README.md`: ภาพรวม, ฟีเจอร์, สถาปัตยกรรม (ฝังภาพ/Mermaid), วิธีติดตั้งทั้งแบบ Docker และแบบ manual ทีละขั้น, ตัวแปร env, วิธีรันทดสอบ,
  ลิงก์ demo (เว้นช่องให้เติม), หมายเหตุว่าไม่มีการ login, การตัดสินใจเชิงออกแบบ (ทำไม 302, ทำไม buffer, ทำไม Sqids), แผนต่อยอด

## 10. เกณฑ์ยอมรับ (ต้องผ่านทั้งหมด)
1. สร้างลิงก์จาก UI แล้วเปิด Short URL ไปถึงปลายทางจริง (302)
2. สแกน QR ที่ดาวน์โหลดจากระบบแล้วเปิดปลายทางจริง และถูกนับเป็น "สแกน" แยกจาก "คลิก"
3. หน้าประวัติแสดงรายการ URL/Short URL และสถิติที่ตรงกับความจริง
4. Alias ภาษาไทย `/กาแฟ` ใช้งานได้
5. ลิงก์หมดอายุ/ปิดใช้งาน/ครบจำนวน แสดง 410 ถูกต้อง
6. `npm run typecheck && npm run lint && npm test` ผ่านทั้งหมด และ `docker compose up` ใช้งานได้จากเครื่องใหม่
7. ER และ DFD ในเอกสารตรงกับระบบจริง

## 11. นอกขอบเขต (ห้ามทำ ถ้าไม่ได้สั่ง)
ระบบสมาชิก/login, Redis, GeoIP, การตรวจ URL กับ Safe Browsing, Bulk CSV, ลิงก์ตั้งรหัสผ่าน, A/B routing

## 12. กติกาการทำงาน
- เริ่มทุกเฟสด้วยการอ่าน CLAUDE.md และ docs/SPEC.md; งานใหญ่ให้วางแผนก่อนลงมือ
- ทำทีละ milestone เล็กๆ; ก่อนจบทุกเฟสต้องรัน typecheck, lint, test ให้ผ่าน แล้ว commit (ข้อความแบบ conventional commits)
- เขียน test ไปพร้อมโค้ด ไม่ทำทีหลัง
- ถ้า SPEC กำกวมหรือขัดกัน ให้ถามก่อนเดา ถ้าตัดสินใจเองให้บันทึกใน docs/DECISIONS.md
- โค้ดและคอมเมนต์เป็นภาษาอังกฤษ ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย
- ห้ามทำสิ่งที่อยู่ในหัวข้อ "นอกขอบเขต"
