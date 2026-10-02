# Data Flow Diagram — Pulse Link

สัญลักษณ์ (วาดด้วย Mermaid flowchart):
สี่เหลี่ยม = External Entity, วงกลม = Process, ทรงกระบอก = Data Store

## DFD Level 0 (Context Diagram)

```mermaid
flowchart LR
    Creator["ผู้สร้างลิงก์<br/>(เบราว์เซอร์ + cookie pl_owner)"]
    Visitor["ผู้เยี่ยมชม<br/>(คลิกลิงก์ / สแกน QR / บอท preview)"]
    Dest["เว็บไซต์ปลายทาง"]

    P0(("0<br/>ระบบ Pulse Link"))

    Creator -- "URL ปลายทาง, alias, วันหมดอายุ, จำกัดคลิก" --> P0
    Creator -- "คำสั่ง เปิด/ปิด/ลบ ลิงก์, ขอสถิติ, ขอ QR" --> P0
    P0 -- "Short URL, รายการประวัติ" --> Creator
    P0 -- "รูป QR (PNG/SVG)" --> Creator
    P0 -- "สถิติคลิก/สแกน (Dashboard)" --> Creator

    Visitor -- "GET /:code (+ s=qr, User-Agent, Referer)" --> P0
    P0 -- "302 Location / หน้า 404, 410" --> Visitor
    Visitor -. "เปิดปลายทางตาม Location" .-> Dest
```

ระบบไม่ติดต่อเว็บปลายทางโดยตรง (ไม่ fetch, ไม่ resolve DNS) เพียงส่ง `Location` ให้เบราว์เซอร์ของผู้เยี่ยมชมไปเอง

## DFD Level 1

```mermaid
flowchart LR
    Creator["ผู้สร้างลิงก์"]
    Visitor["ผู้เยี่ยมชม"]

    P1(("1.0<br/>จัดการลิงก์"))
    P2(("2.0<br/>Redirect"))
    P3(("3.0<br/>บันทึกคลิก"))
    P4(("4.0<br/>สร้าง QR"))
    P5(("5.0<br/>คำนวณสถิติ"))

    D1[("D1 links")]
    D2[("D2 clicks")]
    D3[("D3 link cache<br/>(LRU ในหน่วยความจำ)")]
    D4[("D4 click buffer<br/>(ในหน่วยความจำ)")]

    %% 1.0 Manage links
    Creator -- "สร้าง/แก้ไข/ลบ ลิงก์ + owner token" --> P1
    P1 -- "Short URL, รายการลิงก์ + clickCount, qrScanCount" --> Creator
    P1 -- "INSERT / UPDATE / DELETE" --> D1
    D1 -- "ลิงก์ของ owner" --> P1
    D2 -- "จำนวนสแกน QR" --> P1
    P1 -- "invalidate เมื่อแก้/ลบ" --> D3

    %% 2.0 Redirect
    Visitor -- "GET /:code, s=qr, UA, Referer" --> P2
    D3 -- "link ที่ cache ไว้" --> P2
    P2 -- "เติม cache (TTL 60s, negative 10s)" --> D3
    D1 -- "link ตาม code" --> P2
    P2 -- "atomic UPDATE click_count (เฉพาะลิงก์มี max_clicks)" --> D1
    P2 -- "302 / 404 / 410" --> Visitor
    P2 -- "เหตุการณ์คลิก (ยกเว้น HEAD)" --> P3

    %% 3.0 Record clicks
    P3 -- "เพิ่มเข้า buffer (source, device, browser, os, referrer_host, is_bot)" --> D4
    D4 -- "batch ทุก 1s / ครบ 100 / ตอน shutdown" --> P3
    P3 -- "INSERT clicks แบบ batch" --> D2
    P3 -- "เพิ่ม click_count (ลิงก์ไม่มี max_clicks, ไม่ใช่บอท)" --> D1

    %% 4.0 QR
    Creator -- "ขอ QR (format, size, download)" --> P4
    D1 -- "code ของลิงก์ (ตรวจ owner)" --> P4
    P4 -- "PNG/SVG ของ BASE_URL/code?s=qr" --> Creator

    %% 5.0 Stats
    Creator -- "ขอสถิติ (days=7 หรือ 30)" --> P5
    D1 -- "ตรวจ owner" --> P5
    D2 -- "คลิกในช่วงวัน" --> P5
    P5 -- "totals, byDay, byDevice, byBrowser, byReferrer, recent" --> Creator
```

### คำอธิบาย Process

| # | Process | Endpoint | สรุป |
|---|---|---|---|
| 1.0 | จัดการลิงก์ | `POST/GET/PATCH/DELETE /api/links[/:id]` | ตรวจ URL, normalize alias (NFC + lowercase), สร้าง code ด้วย Sqids จาก `nextval`, ตรวจ owner (ไม่ตรง → 404) |
| 2.0 | Redirect | `GET /:code`, `HEAD /:code` | decode + NFC → cache → DB; ไม่พบ 404, ปิด/หมดอายุ/ครบจำนวน 410, พบ 302 + `Cache-Control: no-store` |
| 3.0 | บันทึกคลิก | (ภายใน) | แยก UA ด้วย ua-parser-js, ตรวจบอท, เก็บเฉพาะ hostname ของ Referer, flush แบบ batch ไม่หน่วง redirect |
| 4.0 | สร้าง QR | `GET /api/links/:id/qr` | เข้ารหัส `${BASE_URL}/${encodeURIComponent(code)}?s=qr`, error correction M, margin 2 |
| 5.0 | คำนวณสถิติ | `GET /api/links/:id/stats` | จัดกลุ่มวันตาม Asia/Bangkok, เติมวันว่างเป็น 0, ไม่รวมบอท (แยกใน totals.bots) |

### Data Store

| # | Store | ชนิด | หมายเหตุ |
|---|---|---|---|
| D1 | links | PostgreSQL | ดู [ER.md](ER.md) |
| D2 | clicks | PostgreSQL | ดู [ER.md](ER.md) |
| D3 | link cache | หน่วยความจำต่อโปรเซส | สูงสุด 5000 รายการ, TTL 60s, negative cache 10s; ไม่ใช้ตัดสินลิงก์ที่มี `max_clicks` |
| D4 | click buffer | หน่วยความจำต่อโปรเซส | อาจเสียคลิกได้ไม่เกินช่วง flush หากโปรเซส crash |
