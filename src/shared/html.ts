import type { FastifyReply } from 'fastify';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

export interface StatusPage {
  status: number;
  title: string;
  message: string;
}

/**
 * Minimal self-contained Thai status page (404/410) for the redirect service.
 * Every interpolated value is escaped; no external assets so it works in APP_MODE=redirect.
 */
export function renderStatusPage(page: StatusPage): string {
  const title = escapeHtml(page.title);
  const message = escapeHtml(page.message);
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Pulse Link</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: #0b1020; color: #e6e9f2;
         font-family: "IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif; }
  main { max-width: 28rem; text-align: center; }
  .code { font-size: 4rem; font-weight: 700; color: #3df5a7; margin: 0; letter-spacing: .05em; }
  h1 { font-size: 1.5rem; margin: .5rem 0; }
  p { color: #a9b0c6; line-height: 1.6; }
</style>
</head>
<body>
<main>
<p class="code">${page.status}</p>
<h1>${title}</h1>
<p>${message}</p>
</main>
</body>
</html>
`;
}

/** Shared by the redirect (unknown code) and the not-found/bad-URL handlers outside /api. */
export const NOT_FOUND_PAGE = renderStatusPage({
  status: 404,
  title: 'ไม่พบลิงก์นี้',
  message: 'ลิงก์อาจพิมพ์ผิด หรือถูกลบไปแล้ว กรุณาตรวจสอบกับผู้ที่ส่งลิงก์ให้คุณ',
});

/** Send a status page; never cached so a re-enabled link works immediately. */
export function sendHtml(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .status(status)
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(html);
}
