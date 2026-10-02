# Demo — Pulse Link

> สคริปต์สาธิต 30 นาทีฉบับเต็มจะเขียนใน P7 ไฟล์นี้บันทึกเฉพาะเรื่องที่ต้องรู้ก่อนสาธิต redirect และสถิติ

## การนับบอท (DECISIONS D-019)

| ผู้เรียก | นับเป็น | ผลต่อสถิติ |
|---|---|---|
| เบราว์เซอร์บนมือถือ/คอมพิวเตอร์, in-app browser ของ LINE | คน | นับใน `clickCount` / `qrScanCount` และใช้โควตา `max_clicks` |
| `curl`, `wget`, python-requests, Go-http-client | คน | นับเหมือนเบราว์เซอร์ (สาธิตด้วย curl ได้) |
| ตัว preview ลิงก์ของ LINE, Facebook, Slack, WhatsApp, Telegram, Discord | บอท | บันทึกเป็น `is_bot=true` ไม่นับ ไม่กินโควตา |
| Googlebot, Bingbot และ crawler อื่น, HeadlessChrome, ไม่มี User-Agent | บอท | เหมือนข้างบน |

จุดที่ควรชี้ตอนสาธิต: วางลิงก์ใน LINE แล้ว LINE จะดึง preview ก่อน 1 ครั้ง ครั้งนั้นเป็นบอทและไม่ทำให้ตัวเลขคลิกเพิ่ม
ส่วนการกดเปิดลิงก์จริงใน LINE นับเป็นคน

## สาธิตด้วย command line

```bash
# คลิกปกติ (นับเป็นคน)
curl -i http://localhost:3000/abc123

# สแกน QR (QR เข้ารหัส ?s=qr)
curl -i "http://localhost:3000/abc123?s=qr"

# HEAD ไม่ถูกบันทึก
curl -I http://localhost:3000/abc123

# จำลองตัว preview ของ LINE (บันทึกเป็นบอท)
curl -i -A "facebookexternalhit/1.1;line-poker/1.0" http://localhost:3000/abc123
```

alias ภาษาไทยต้องส่งแบบ percent-encoded เมื่อใช้ command line เพราะ HTTP parser ของ Node ปฏิเสธไบต์ภาษาไทยดิบ (D-020)
ในเบราว์เซอร์พิมพ์ `http://localhost:3000/กาแฟ` ได้ตรงๆ เพราะเบราว์เซอร์ encode ให้เอง

```bash
curl -i http://localhost:3000/%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F   # /กาแฟ
```

สถิติจะขึ้นหลัง click buffer flush (ทุก `CLICK_FLUSH_MS` ค่าเริ่มต้น 1 วินาที)
