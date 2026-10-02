# Architecture — Pulse Link

Pulse Link เป็น **modular monolith**: โค้ดชุดเดียว แบ่งโมดูลตามฟีเจอร์ชัดเจน และเลือกบทบาทของโปรเซสได้ด้วย `APP_MODE`
จึง deploy เป็นโปรเซสเดียว (ง่าย, free host) หรือแยกเป็น 2 service (API กับ Redirect) ที่ใช้ฐานข้อมูลเดียวกันได้โดยไม่ต้องแก้โค้ด

## 1. ภาพรวม

```mermaid
flowchart LR
    subgraph Client["ฝั่งผู้ใช้"]
        SPA["React SPA<br/>(hash routing, ภาษาไทย)"]
        Visitor["ผู้เยี่ยมชม<br/>(คลิก / สแกน QR)"]
    end

    subgraph App["Fastify (Node.js 20, TypeScript)"]
        direction TB
        Plugins["helmet · rate-limit · cookie pl_owner<br/>zod validation · error handler"]
        Static["static<br/>GET / , /assets/*"]
        Links["modules/links<br/>/api/links CRUD"]
        QR["modules/qr<br/>/api/links/:id/qr"]
        Stats["modules/stats<br/>/api/links/:id/stats"]
        Redirect["modules/redirect<br/>GET /:code"]
        Cache[("LRU cache<br/>ลิงก์ 5000 / 60s<br/>ไม่พบ 1000 / 10s")]
        Buffer[("Click buffer")]
        Clicks["modules/clicks<br/>UA parse · bot · flush"]
        Health["/health"]
    end

    PG[("PostgreSQL<br/>links · clicks")]
    Dest["เว็บปลายทาง"]

    SPA -- "JSON /api" --> Links
    SPA --> QR
    SPA --> Stats
    SPA -. "โหลดไฟล์" .-> Static
    Visitor -- "GET /:code" --> Redirect
    Redirect --> Cache
    Redirect -- "302 Location" --> Visitor
    Visitor -.-> Dest
    Redirect -- "enqueue" --> Buffer
    Buffer --> Clicks
    Links --> PG
    QR --> PG
    Stats --> PG
    Redirect --> PG
    Clicks -- "batch INSERT + UPDATE" --> PG
```

### โครงสร้างโค้ด

```
src/
  app.ts                 buildApp({ mode }) ลงทะเบียน plugin/route ตาม APP_MODE
  server.ts, main.ts     เริ่ม server ตาม APP_MODE + ผูก SIGTERM/SIGINT กับ graceful shutdown
  entry/{all,api,redirect}.ts   จุดเริ่มที่บังคับโหมด
  scripts/migrate.ts     runner ของ db/migrations
  shared/                config (zod), db (pg Pool), errors + error handler, validation (zod → 400), migrate, code generator (Sqids),
                         url validator, alias normalizer, owner cookie, html escape/หน้า 404, lru, bot detection
  modules/
    links/               CRUD
    redirect/            LinkCache (2 LRU), resolver (cache → DB, atomic max_clicks), หน้า 410
    clicks/              ua-parser (device/browser/os), ClickBuffer + flush SQL
    qr/                  PNG/SVG
    stats/               query สถิติ (Asia/Bangkok)
db/migrations/           SQL ธรรมดา + runner
web/                     React + Vite (build แล้ว Fastify เสิร์ฟ)
```

แต่ละโมดูลเป็น Fastify plugin ที่ไม่ import ภายในของกันและกัน ยกเว้นผ่าน interface ที่ประกาศไว้
(`redirect` → `ClickBuffer.enqueue`, `links` → `cache.invalidate`) จึงย้ายไปอยู่คนละ service ได้

## 2. โหมดการรัน (APP_MODE)

| โหมด | Route ที่เปิด | ใช้เมื่อ |
|---|---|---|
| `all` (ค่าเริ่มต้น) | `/api/*`, static (`/`, `/assets/*`), `/:code`, `/health` | deploy โปรเซสเดียว / `docker compose up` |
| `api` | `/api/*`, static, `/health` | service จัดการลิงก์ + หน้าเว็บ |
| `redirect` | `/:code`, `/health` | service redirect ที่ scale แยกได้ (hot path) |

```mermaid
flowchart TB
    subgraph Single["แบบที่ 1: APP_MODE=all"]
        U1["ผู้ใช้"] --> A1["pulse-link (all)"]
        A1 --> DB1[("PostgreSQL")]
    end

    subgraph Split["แบบที่ 2: แยก service"]
        U2["ผู้ใช้"] --> LB["Reverse proxy / LB"]
        LB -- "/api/*, /, /assets/*" --> API["pulse-link (api)"]
        LB -- "/:code" --> R1["pulse-link (redirect) ตัวที่ 1"]
        LB -- "/:code" --> R2["pulse-link (redirect) ตัวที่ 2"]
        API --> DB2[("PostgreSQL (shared)")]
        R1 --> DB2
        R2 --> DB2
    end
```

ข้อจำกัดเมื่อแยก: cache และ click buffer อยู่ในหน่วยความจำของแต่ละโปรเซส
การแก้/ลบลิงก์ผ่าน API จึงอาจยังเห็นค่าเก่าใน redirect service ได้ไม่เกิน TTL 60 วินาที
(ลิงก์ที่มี `max_clicks` ไม่ได้รับผลเพราะตัดสินที่ DB เสมอ) — ดู [DECISIONS.md](DECISIONS.md)

## 3. Flow การ redirect และบันทึกคลิก

```mermaid
sequenceDiagram
    autonumber
    participant V as ผู้เยี่ยมชม
    participant R as Redirect route
    participant C as LRU cache
    participant DB as PostgreSQL
    participant B as Click buffer

    V->>R: GET /:code (s=qr?, User-Agent, Referer)
    R->>R: decode percent-encoding, NFC, lowercase ละติน
    R->>C: get(code)
    alt cache miss
        R->>DB: SELECT link WHERE code = $1
        DB-->>R: link หรือไม่พบ
        R->>C: set (ลิงก์: LRU 5000 / 60s, ไม่พบ: LRU แยก 1000 / 10s)
    end
    alt ไม่พบ
        R-->>V: 404 หน้า HTML ภาษาไทย
    else ปิดใช้งาน หรือหมดอายุ
        R-->>V: 410 หน้า HTML ภาษาไทย
    else มี max_clicks และไม่ใช่บอท และไม่ใช่ HEAD
        R->>DB: UPDATE links SET click_count = click_count + 1 WHERE ... RETURNING
        alt ไม่ได้แถวกลับมา
            R-->>V: 410 ครบจำนวนคลิก
        else ได้แถว
            R-->>V: 302 Location target_url, Cache-Control no-store
        end
    else ปกติ (ไม่มี max_clicks หรือเป็นบอท/HEAD บนลิงก์ที่ยังไม่ครบ ตรวจจาก DB)
        R-->>V: 302 Location target_url, Cache-Control no-store
    end
    opt method ไม่ใช่ HEAD และ redirect สำเร็จ
        R-)B: enqueue(linkId, source, device, browser, os, referrerHost, isBot, counted)
    end

    Note over B,DB: แยกจาก request ไม่หน่วง redirect
    loop ทุก CLICK_FLUSH_MS (1000ms) หรือครบ 100 รายการ หรือตอน shutdown
        B->>DB: BEGIN
        B->>DB: INSERT INTO clicks SELECT FROM unnest(...) JOIN links
        B->>DB: UPDATE links SET click_count += n (เฉพาะไม่ใช่บอท และ counted = false)
        B->>DB: COMMIT
    end
```

### ประเด็นสำคัญ

- **302 เท่านั้น** + `Cache-Control: no-store`: 301 ถูกเบราว์เซอร์ cache ทำให้คลิกครั้งต่อไปไม่ผ่านระบบและนับไม่ได้
- **ไม่หน่วง redirect**: การบันทึกคลิกเป็นแค่การ push ลง array ในหน่วยความจำ งาน DB ทำทีหลังแบบ batch
- **max_clicks แบบ atomic**: ใช้ UPDATE คำสั่งเดียวที่มีเงื่อนไข `click_count < max_clicks` ให้ PostgreSQL row lock
  ตัดสินกรณีคลิกพร้อมกัน ไม่ใช้ cache; buffer entry มีธง `counted=true` เพื่อไม่ให้ flush บวกซ้ำ
- **บอท** (ตัว preview ของแอปแชต, crawler): บันทึกเป็น `is_bot=true` ไม่เพิ่ม `click_count` ไม่กินโควตา `max_clicks`
- **HEAD** ตอบเหมือน GET แต่ไม่บันทึกคลิก
- **ลิงก์ถูกลบก่อน flush**: `JOIN links` ตัดแถวกำพร้าทิ้ง ไม่ให้ FK ทำให้ทั้ง batch ล้ม
- **DB ล่มตอน flush**: คืนรายการเข้า buffer (มีเพดาน) แล้วลองใหม่รอบถัดไป
- **Graceful shutdown** (SIGTERM/SIGINT): `app.close()` หยุดรับ request และรอ request ที่ค้างอยู่ →
  hook `onClose` flush buffer จนหมด (ให้เวลาสูงสุด 5 วินาที ถ้า DB ไม่ตอบให้ log จำนวนที่เสียแล้วปิดต่อ) → `db.end()` → exit
- **Negative cache แยก LRU**: code ที่ไม่พบเก็บใน LRU ของตัวเอง (1000 รายการ) การสุ่มเดา code จึงดันลิงก์จริงออกจาก cache ไม่ได้
- **ลำดับ route**: find-my-way ให้ route แบบ static (`/health`, `/api/*`, `/assets/*`) ชนะ `/:code` เสมอไม่ว่าลงทะเบียนก่อนหลัง
  และ `/:code` จับได้แค่ 1 segment; `/`, `/api`, `/favicon.ico` ที่ตกมาถึง `/:code` ตอบ 404 โดยไม่แตะ DB
- **percent-encoding เสีย** (`/%E0%B8`): `frameworkErrors` ตอบหน้า 404 ภาษาไทยเดียวกับกรณีไม่พบ ไม่เผยข้อความของ Fastify
- **Error นอก /api** เป็นหน้า HTML ภาษาไทย ส่วนใต้ `/api` เป็น JSON `{ error: { code, message } }`

## 4. Flow การสร้างลิงก์

```mermaid
sequenceDiagram
    autonumber
    participant UI as React SPA
    participant L as Links route
    participant DB as PostgreSQL

    UI->>L: POST /api/links { url, alias?, expiresAt?, maxClicks? } + cookie pl_owner
    L->>L: zod validate, ตรวจ URL (http/https, ไม่มี userinfo, ไม่ใช่ private IP, ไม่ใช่โดเมนตัวเอง)
    alt มี alias
        L->>L: NFC + lowercase, ตรวจรูปแบบ 3-32 ตัว และคำสงวน
        L->>DB: INSERT (code = alias, is_custom_alias = true)
        DB-->>L: unique_violation → 409
    else ไม่มี alias
        loop สูงสุด 5 ครั้ง
            L->>DB: SELECT nextval('links_id_seq')
            L->>L: code = Sqids.encode([id])
            L->>DB: INSERT (id, code)
            DB-->>L: สำเร็จ หรือ unique_violation (ชน alias) → ลองใหม่
        end
    end
    L-->>UI: 201 { id, code, shortUrl, targetUrl, qrUrl, ... }
```

## 5. การจัด route ไม่ให้ชนกัน

- `/:code` จับเพียง 1 segment; route แบบคงที่ (`/health`, `/`, `/favicon.ico`, `/robots.txt`) มีลำดับความสำคัญสูงกว่า parametric ใน find-my-way
- ไฟล์ build ของ Vite เสิร์ฟที่ prefix `/assets/` (หลาย segment จึงไม่ตก `/:code`) และไม่มี SPA fallback เพราะใช้ hash routing
- alias ห้ามใช้คำสงวน `api, health, assets, favicon.ico, robots.txt, admin, app, static`
- ตั้ง `maxParamLength` ให้รองรับ alias ไทยที่ percent-encode แล้ว (ไทย 1 ตัว = 9 ตัวอักษรใน URL)

## 6. ความปลอดภัย

- `@fastify/helmet`, ไม่เปิด CORS (same-origin), rate limit: `POST /api/links` 30/นาที/IP และ `/api` รวม 300/นาที/IP (รองรับ `TRUST_PROXY`)
- ความเป็นเจ้าของผ่าน cookie `pl_owner` (UUID, httpOnly, SameSite=Lax, Secure ใน production); ลิงก์ของคนอื่นตอบ 404 เพื่อไม่เปิดเผยการมีอยู่
- SQL แบบ parameterized ทั้งหมด, escape HTML ทุกหน้าที่ server เรนเดอร์ (404/410)
- ตรวจ URL ปลายทางเพื่อกัน open redirect ไปยังเครือข่ายภายในและกัน redirect วนกลับมาที่ระบบเอง
