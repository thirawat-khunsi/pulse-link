# Deploy — Pulse Link

คู่มือ deploy แบบทีละขั้น: ฐานข้อมูล **Neon** (PostgreSQL ฟรี) + **Render** (free web service จาก Dockerfile)
ใช้ image เดียวกับ `docker compose up` จึงพฤติกรรมเหมือนเครื่อง local ทุกอย่าง

> หน้าจอและชื่อเมนูของ Neon / Render เปลี่ยนได้ตามเวลา ขั้นตอนด้านล่างเขียนตามหลักการ ถ้าชื่อปุ่มต่างไปให้หาเมนูที่ทำหน้าที่เดียวกัน
> host อื่นที่รัน Docker image ได้ (Koyeb, Northflank, Google Cloud Run ฯลฯ) ใช้ขั้นตอนเดียวกัน ต่างกันแค่หน้าตั้งค่า

## 0. สิ่งที่ image ทำให้อัตโนมัติ

- build แบบ multi-stage: compile TypeScript ด้วย `tsc` แล้ว image สุดท้ายมีแค่ `dist/`, production dependencies และ `db/migrations`
- รันด้วยผู้ใช้ `node` (uid 1000) ไม่ใช่ root
- ตอนเริ่ม container: `node dist/scripts/migrate.js` (apply migration ที่ยังไม่ได้รัน, มี advisory lock จึงรันหลาย instance พร้อมกันได้)
  แล้ว `exec node dist/main.js`
- `HEALTHCHECK` เรียก `GET /health` ทุก 15 วินาที (เช็คว่าโปรเซสยังตอบได้ ไม่ได้เช็ค DB)
- รับ SIGTERM แล้วปิดแบบ graceful: หยุดรับ request → flush click buffer (รอ DB สูงสุด 5 วินาที) → ปิด connection pool

ทดสอบ image บนเครื่องก่อน deploy:

```bash
docker compose up --build        # app http://localhost:3000 + postgres
curl http://localhost:3000/health   # {"ok":true,"mode":"all"}
```

## 1. สร้างฐานข้อมูลบน Neon

1. สมัครที่ <https://neon.tech> แล้วสร้าง Project ใหม่
   - Postgres version: 16 ขึ้นไป (ตรงกับ `postgres:16-alpine` ใน compose)
   - Region: **AWS Asia Pacific (Singapore)** ใกล้ผู้ใช้ไทยที่สุด และควรเลือก region ของ host ให้ใกล้กัน
2. ไปที่ **Connection Details / Connect** เลือก database `neondb` (หรือสร้าง `pulse_link`) และ role ที่สร้างให้
3. คัดลอก connection string แบบ **Direct connection** (host **ไม่มี** `-pooler`) ไม่ใช่แบบ Pooled
   - เหตุผล: ตัว migrate ใช้ `pg_advisory_lock` ระดับ session และ transaction หลายคำสั่ง ซึ่งใช้กับ PgBouncer
     แบบ transaction pooling ไม่ได้; แอปมี pool ของตัวเอง (สูงสุด 10 connection) อยู่แล้ว
4. แก้ท้าย connection string ให้เป็น `sslmode=verify-full`
   ```
   postgresql://<user>:<password>@ep-xxxx-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full
   ```
   - Neon ให้มาเป็น `sslmode=require&channel_binding=require`: driver `pg` ถือว่า `require` = `verify-full` อยู่แล้ว
     แต่จะพิมพ์ SECURITY WARNING ทุกครั้งที่เริ่ม; `channel_binding` ถูก `pg` ข้ามไป ลบออกได้ (ทดสอบแล้วว่าใส่ไว้ก็ไม่ error)
5. (ไม่บังคับ) ทดสอบจากเครื่องตัวเองว่าเชื่อมต่อและ migrate ได้:
   ```bash
   DATABASE_URL='postgresql://...?...sslmode=verify-full' npm run migrate
   # Applied: 001_init.sql
   ```
   ไม่ต้อง migrate เองก็ได้ เพราะ container จะ migrate ให้ตอนเริ่ม

> Neon free จะพัก compute เมื่อไม่มีการใช้งานราว 5 นาที query แรกหลังพักจะช้าขึ้นเล็กน้อย (cold start ของ DB) ไม่กระทบความถูกต้อง

## 2. Deploy บน Render

1. push โค้ดขึ้น GitHub (repo นี้)
2. สมัคร <https://render.com> → **New → Web Service** → เชื่อม GitHub แล้วเลือก repo `pulse-link`
3. ตั้งค่า
   | ช่อง | ค่า |
   |---|---|
   | Name | เช่น `pulse-link` (จะได้ URL `https://pulse-link.onrender.com` ใช้เป็น `BASE_URL`) |
   | Region | **Singapore** (ใกล้ Neon) |
   | Branch | `main` |
   | Runtime / Language | **Docker** (Render หา `Dockerfile` ที่ root เอง) |
   | Instance type | **Free** |
   | Health Check Path | `/health` |
4. ใส่ **Environment Variables** ตามหัวข้อ 3 (อย่างน้อย `DATABASE_URL`, `BASE_URL`, `NODE_ENV`, `TRUST_PROXY`)
   - ไม่ต้องตั้ง `PORT`: Render กำหนดให้เอง (ค่าเริ่มต้น 10000) และแอปอ่าน `PORT` อยู่แล้ว
5. กด **Create Web Service** แล้วดู Logs ว่ามี
   ```
   Applied: 001_init.sql            (ครั้งแรก; ครั้งต่อไปจะเป็น Database is already up to date)
   ... "msg":"pulse-link started"
   ```
6. ทุกครั้งที่ push เข้า `main` Render จะ build และ deploy ใหม่ให้อัตโนมัติ (Auto-Deploy)

ข้อจำกัดของ Render free ที่ควรรู้ (และควรเล่าตอนสาธิต):
- ไม่มีคนใช้ ~15 นาที instance จะหลับ request แรกหลังหลับรอปลุกประมาณ 30-60 วินาที
  → เปิด URL ล่วงหน้าก่อนสาธิตสักครู่
- ก่อนหลับ Render ส่ง SIGTERM แอปจึง flush คลิกที่ค้างใน buffer ลง DB ก่อนปิด ไม่เสียข้อมูล
- in-memory cache เริ่มว่างทุกครั้งที่ปลุก (ไม่มีผลต่อความถูกต้อง แค่ request แรกๆ ไปถาม DB)

## 3. ตัวแปร environment

| ตัวแปร | ค่าบน Render | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | connection string จาก Neon (Direct, `sslmode=verify-full`) | ต้องตั้ง; เก็บเป็น secret |
| `BASE_URL` | `https://pulse-link.onrender.com` | origin สาธารณะ **ไม่มี `/` ท้าย** ใช้สร้าง short URL / QR และกันลิงก์วนกลับเข้าระบบเอง |
| `NODE_ENV` | `production` | log ระดับ info และ cookie `pl_owner` เป็น `Secure` (เมื่อ `BASE_URL` เป็น https, D-022) |
| `TRUST_PROXY` | `loopback,uniquelocal` | ดูหัวข้อ 4 |
| `APP_MODE` | `all` | ค่าเริ่มต้น; `api` / `redirect` ใช้เมื่อแยก service (ARCHITECTURE §2) |
| `CLICK_FLUSH_MS` | ไม่ต้องตั้ง (1000) | ช่วง flush click buffer, 50-60000 |
| `PORT` | ไม่ต้องตั้ง | host กำหนดเอง; local ใช้ 3000 |

ถ้าตั้งค่าผิด แอปจะไม่เริ่มและพิมพ์รายการตัวแปรที่ผิดใน log (`Invalid environment configuration: ...`)

## 4. TRUST_PROXY

บน free host ทุก request ผ่าน load balancer ของ host ก่อนถึงแอป ถ้าไม่ตั้ง `TRUST_PROXY` แอปจะเห็น IP ของ load balancer
เป็น IP ผู้ใช้ทุกคน rate limit (`POST /api/links` 30 ครั้ง/นาที, `/api` 300 ครั้ง/นาที ต่อ IP) จะนับรวมทุกคนเป็นคนเดียว

| ค่า | ผล | ใช้เมื่อ |
|---|---|---|
| `false` (ค่าเริ่มต้น) | ใช้ IP ของ socket ตรงๆ | รันเปิดตรงไม่มี proxy, `docker compose` บนเครื่อง |
| `loopback,uniquelocal` | **แนะนำบน Render** เชื่อเฉพาะ hop ที่เป็น IP ภายใน (127/8, 10/8, 172.16/12, 192.168/16, fc00::/7) | proxy ของ host อยู่ในเครือข่ายภายใน |
| รายการ IP/CIDR เช่น `10.0.0.0/8,100.64.0.0/10` | เชื่อเฉพาะช่วงที่ระบุ | host ประกาศช่วง IP ของ proxy ไว้ |
| `true` | เชื่อ `X-Forwarded-For` ทั้งหมด | **ไม่แนะนำ** |

ทำไมไม่ใช้ `true`: ผู้ใช้ใส่ `X-Forwarded-For: 6.6.6.6` มาเองได้ แอปจะเชื่อค่าซ้ายสุดที่ปลอมมา และหลบ rate limit ได้
(ทดสอบแล้ว: `true` ได้ `6.6.6.6`, `loopback,uniquelocal` ได้ IP จริงที่ proxy ต่อท้ายไว้)
ไม่รองรับจำนวน hop แบบตัวเลข (D-014)

**ตรวจหลัง deploy ว่าตั้งถูก**: เปิด `https://<app>/api/links` จากเครื่องตัวเอง แล้วดู log ของ request นั้นใน Render
ค่า `"remoteAddress"` ต้องเป็น IP สาธารณะของคุณ (เทียบกับ `curl https://ifconfig.me`)
- ถ้าเป็น `10.x` / `172.x` / `100.64.x` แปลว่า proxy ใช้ช่วงที่ยังไม่ได้เชื่อ ให้เพิ่มช่วงนั้น เช่น `loopback,uniquelocal,100.64.0.0/10`
- ถ้าเป็น IP ที่ไม่ใช่ของคุณและไม่ใช่ IP ภายใน ให้ลองตั้งตามช่วง IP ที่ host ประกาศ

## 5. ทดสอบหลัง deploy

ตั้งตัวแปรก่อน:

```bash
APP=https://pulse-link.onrender.com
JAR=$(mktemp)          # เก็บ cookie pl_owner เหมือนเบราว์เซอร์
```

1. **Health**
   ```bash
   curl -s $APP/health                       # {"ok":true,"mode":"all"}
   ```
2. **สร้างลิงก์** และตรวจ cookie (`Secure; HttpOnly; SameSite=Lax`)
   ```bash
   HDR=$(mktemp)
   BODY=$(curl -s -D $HDR -c $JAR -X POST $APP/api/links \
     -H 'content-type: application/json' \
     -d '{"url":"https://example.com/hello","alias":"deploy-test"}')
   grep -i -E '^HTTP|set-cookie' $HDR   # HTTP/2 201, set-cookie: pl_owner=...; Secure; HttpOnly; SameSite=Lax
   echo "$BODY"                         # "shortUrl":"https://pulse-link.onrender.com/deploy-test"
   ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | cut -d: -f2)
   ```
3. **Redirect 302 + no-store**
   ```bash
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $APP/deploy-test        # 302 https://example.com/hello
   curl -s -I $APP/deploy-test | grep -i cache-control                              # cache-control: no-store
   curl -s -o /dev/null -w '%{http_code}\n' "$APP/deploy-test?s=qr"                 # 302 (นับเป็นสแกน)
   ```
4. **alias ภาษาไทย** สร้างจากหน้าเว็บ (P6) หรือส่ง JSON แบบ `\u` แล้วเปิดในเบราว์เซอร์ `https://<app>/กาแฟ`
   ```bash
   curl -s -b $JAR -X POST $APP/api/links -H 'content-type: application/json' \
     -d '{"url":"https://example.com/coffee","alias":"\u0e01\u0e32\u0e41\u0e1f"}'
   curl -s -o /dev/null -w '%{http_code}\n' $APP/%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F   # 302
   ```
   (command line ต้องใช้ URL แบบ encode แล้ว ดู D-020 / DEMO.md)
5. **สถิติ** รอ ~1 วินาทีให้ buffer flush แล้วดูตัวเลข
   ```bash
   sleep 2; curl -s -b $JAR "$APP/api/links?limit=5" | grep -o '"code":"[^"]*"\|"clickCount":[0-9]*\|"qrScanCount":[0-9]*'
   # deploy-test: clickCount 1 (curl -I เป็น HEAD จึงไม่นับ), qrScanCount 1
   ```
6. **404 / 410**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' $APP/does-not-exist                         # 404 (หน้า HTML ไทย)
   curl -s -b $JAR -X PATCH $APP/api/links/$ID -H 'content-type: application/json' -d '{"isActive":false}'
   curl -s -o /dev/null -w '%{http_code}\n' $APP/deploy-test                            # 410 (ถูกปิด)
   ```
7. **ความเป็นเจ้าของ**: เรียกโดยไม่มี cookie ต้องไม่เห็นลิงก์ของคนอื่น
   ```bash
   curl -s "$APP/api/links"                                                            # {"items":[],"nextCursor":null}
   curl -s -o /dev/null -w '%{http_code}\n' $APP/api/links/$ID                         # 404
   ```
8. **TRUST_PROXY** ตรวจ `remoteAddress` ใน log ตามหัวข้อ 4
9. **ลบข้อมูลทดสอบ** (ทำซ้ำกับลิงก์ `กาแฟ` ถ้าไม่ต้องการเก็บไว้สาธิต)
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -b $JAR -X DELETE $APP/api/links/$ID        # 204
   curl -s -o /dev/null -w '%{http_code}\n' $APP/deploy-test                            # 404
   ```

## 6. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| log: `Invalid environment configuration` | ตัวแปรขาดหรือผิดรูปแบบ (เช่น `BASE_URL` ไม่มี `https://`, `TRUST_PROXY=1`) แก้ตามรายการที่พิมพ์ |
| log: `Migration ... failed` / connect timeout | ตรวจ `DATABASE_URL`, ใช้ Direct connection, Neon project ไม่ถูกพัก/ลบ |
| `SECURITY WARNING: The SSL modes 'prefer', 'require'...` | เปลี่ยนเป็น `sslmode=verify-full` |
| สร้างลิงก์แล้ว `INVALID_URL` "ลิงก์กลับมายังโดเมนของระบบเอง" | ตั้งใจ: ห้ามย่อ URL ของ `BASE_URL` เอง (กันวนลูป) |
| หน้าประวัติว่างทุกครั้งที่รีเฟรช | cookie ไม่ถูกเก็บ: ตรวจว่าเปิดผ่าน https และ `BASE_URL` เป็นโดเมนเดียวกับที่เปิด |
| ทุกคนโดน rate limit พร้อมกัน | ยังไม่ได้ตั้ง `TRUST_PROXY` (หัวข้อ 4) |
| request แรกช้ามาก | Render free กำลังปลุก instance (หัวข้อ 2) |
