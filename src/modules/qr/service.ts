import QRCode from 'qrcode';

export type QrFormat = 'png' | 'svg';

// SPEC §5: error correction M, margin 2.
const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 2 } as const;

/** What the QR encodes: the short URL marked as a scan so redirects record source=qr. */
export function qrTarget(baseUrl: string, code: string): string {
  return `${baseUrl}/${encodeURIComponent(code)}?s=qr`;
}

export async function renderQr(text: string, format: QrFormat, size: number): Promise<Buffer> {
  if (format === 'svg') {
    return Buffer.from(await QRCode.toString(text, { ...QR_OPTIONS, type: 'svg', width: size }));
  }
  return QRCode.toBuffer(text, { ...QR_OPTIONS, type: 'png', width: size });
}

/**
 * `attachment` header with an ASCII fallback (`pulse-link-<id>`) for old clients and the real code
 * via RFC 5987 `filename*`, so Thai aliases survive as file names.
 */
export function contentDisposition(id: number, code: string, format: QrFormat): string {
  const ascii = `pulse-link-${id}.${format}`;
  const utf8 = encodeURIComponent(`pulse-link-${code}.${format}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
