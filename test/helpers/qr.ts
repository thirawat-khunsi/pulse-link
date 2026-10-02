import jsQRModule from 'jsqr';
import { PNG } from 'pngjs';

// jsqr is CommonJS with `export default` typings; under NodeNext the callable is `.default`
// (at runtime module.exports and module.exports.default are the same function).
const jsQR = jsQRModule.default;

/** Decode a QR code PNG like a phone camera would: returns the encoded text and image size. */
export function decodeQrPng(buffer: Buffer): {
  text: string | null;
  width: number;
  height: number;
} {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return { text: result?.data ?? null, width: png.width, height: png.height };
}
