import { type SyntheticEvent, useMemo, useState } from 'react';
import { api, ApiError, type CreateLinkInput, type Link } from '../api';
import { CopyButton, QrDownloads, QrImage } from '../components/ui';
import { displayShortUrl, formatDateTime, localInputToIso, normalizeUrlInput } from '../format';
import { href } from '../router';

interface FormState {
  url: string;
  alias: string;
  expiresAt: string;
  maxClicks: string;
}

const EMPTY: FormState = { url: '', alias: '', expiresAt: '', maxClicks: '' };

/** Which input a server error belongs to, so it can be marked invalid. */
function errorField(err: ApiError): keyof FormState | null {
  if (err.code === 'INVALID_URL') return 'url';
  if (err.code === 'INVALID_ALIAS' || err.code === 'ALIAS_TAKEN') return 'alias';
  if (/วันหมดอายุ/.test(err.message)) return 'expiresAt';
  if (/คลิก/.test(err.message)) return 'maxClicks';
  return null;
}

export function CreatePage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field: keyof FormState | null } | null>(
    null,
  );
  const [created, setCreated] = useState<Link | null>(null);
  // The short URL host as the server will build it is unknown until the first link;
  // show this page's own origin as the alias prefix (same host in APP_MODE=all).
  const prefix = useMemo(() => `${window.location.host}/`, []);

  const set = (key: keyof FormState) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (error?.field === key) setError(null);
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = normalizeUrlInput(form.url);
    if (url === '') {
      setError({ message: 'กรุณาใส่ URL ที่ต้องการย่อ', field: 'url' });
      return;
    }
    const input: CreateLinkInput = { url };
    if (form.alias.trim()) input.alias = form.alias.trim();
    const expiresAt = localInputToIso(form.expiresAt);
    if (expiresAt) input.expiresAt = expiresAt;
    if (form.maxClicks.trim()) {
      const n = Number(form.maxClicks);
      if (!Number.isInteger(n) || n < 1) {
        setError({
          message: 'จำกัดจำนวนคลิกต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',
          field: 'maxClicks',
        });
        return;
      }
      input.maxClicks = n;
    }

    setBusy(true);
    setError(null);
    try {
      const link = await api.createLink(input);
      setCreated(link);
      setForm(EMPTY);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setError({
        message: apiError?.message ?? 'สร้างลิงก์ไม่สำเร็จ กรุณาลองใหม่',
        field: apiError ? errorField(apiError) : null,
      });
    } finally {
      setBusy(false);
    }
  };

  const invalid = (key: keyof FormState) => (error?.field === key ? true : undefined);

  return (
    <>
      <h1 className="page-title">ย่อลิงก์ให้สั้น แล้วดูชีพจรของมัน</h1>
      <p className="page-lead">
        สร้าง Short URL พร้อม QR Code ที่นับการสแกนแยกจากการคลิก และติดตามสถิติได้แบบเรียลไทม์
      </p>

      <form className="card" onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor="url">URL ปลายทาง</label>
          <div className="create-row">
            <input
              id="url"
              className="input input-lg"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="วางลิงก์ยาวๆ ที่นี่ เช่น example.com/โปรโมชัน"
              value={form.url}
              onChange={(e) => {
                set('url')(e.target.value);
              }}
              aria-invalid={invalid('url')}
              aria-describedby="url-hint"
              maxLength={2048}
              required
              autoFocus
            />
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'กำลังสร้าง…' : 'ย่อลิงก์'}
            </button>
          </div>
          <span id="url-hint" className="hint">
            ถ้าไม่ใส่ http:// หรือ https:// ระบบจะเติม https:// ให้
          </span>
        </div>

        <details className="advanced">
          <summary>ตัวเลือกขั้นสูง (ชื่อลิงก์เอง, วันหมดอายุ, จำกัดจำนวนคลิก)</summary>
          <div className="advanced-grid">
            <div className="field">
              <label htmlFor="alias">ชื่อลิงก์ (alias)</label>
              <div className="prefix-input">
                <span title={prefix}>{prefix}</span>
                <input
                  id="alias"
                  className="input"
                  type="text"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="เช่น กาแฟ"
                  value={form.alias}
                  onChange={(e) => {
                    set('alias')(e.target.value);
                  }}
                  aria-invalid={invalid('alias')}
                  aria-describedby="alias-hint"
                  maxLength={32}
                />
              </div>
              <span id="alias-hint" className="hint">
                3-32 ตัว ใช้ภาษาไทย a-z 0-9 - _ ได้ (เว้นว่างเพื่อสุ่มให้)
              </span>
            </div>
            <div className="field">
              <label htmlFor="expiresAt">วันหมดอายุ</label>
              <input
                id="expiresAt"
                className="input"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => {
                  set('expiresAt')(e.target.value);
                }}
                aria-invalid={invalid('expiresAt')}
              />
              <span className="hint">หลังจากนี้ลิงก์จะตอบว่า “หมดอายุ”</span>
            </div>
            <div className="field">
              <label htmlFor="maxClicks">จำกัดจำนวนคลิก</label>
              <input
                id="maxClicks"
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="ไม่จำกัด"
                value={form.maxClicks}
                onChange={(e) => {
                  set('maxClicks')(e.target.value);
                }}
                aria-invalid={invalid('maxClicks')}
              />
              <span className="hint">นับทั้งคลิกและสแกน (ไม่นับบอท)</span>
            </div>
          </div>
        </details>

        {error ? (
          <div className="alert" role="alert" style={{ marginTop: 14 }}>
            {error.message}
          </div>
        ) : null}
      </form>

      {created ? <ResultCard link={created} /> : null}
    </>
  );
}

function ResultCard({ link }: { link: Link }) {
  return (
    <section className="card result" aria-labelledby="result-title" aria-live="polite">
      <div>
        <p className="result-label" id="result-title">
          สร้างลิงก์สำเร็จ 🎉
        </p>
        <a className="short-url" href={link.shortUrl} target="_blank" rel="noreferrer">
          {displayShortUrl(link.shortUrl)}
        </a>
        <p className="target">→ {link.targetUrl}</p>
        {link.expiresAt !== null || link.maxClicks !== null ? (
          <div className="meta-list">
            {link.expiresAt !== null ? <span>หมดอายุ {formatDateTime(link.expiresAt)}</span> : null}
            {link.maxClicks !== null ? <span>จำกัด {link.maxClicks} ครั้ง</span> : null}
          </div>
        ) : null}
        <div className="btn-row">
          <CopyButton text={link.shortUrl} className="btn btn-primary" label="คัดลอกลิงก์" />
          <a className="btn" href={link.shortUrl} target="_blank" rel="noreferrer">
            เปิดลิงก์ ↗
          </a>
          <a className="btn" href={href.dashboard(link.id)}>
            ดูสถิติ
          </a>
        </div>
      </div>
      <div className="qr-box">
        <QrImage link={link} />
        <span className="qr-caption">สแกนแล้วนับเป็น “สแกน QR”</span>
        <div className="btn-row">
          <QrDownloads link={link} small />
        </div>
      </div>
    </section>
  );
}
