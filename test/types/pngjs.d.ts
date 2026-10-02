// pngjs 5 (MIT, test-only devDependency) ships no type definitions; only what the QR tests use.
declare module 'pngjs' {
  interface DecodedPng {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel. */
    data: Buffer;
  }

  export const PNG: {
    sync: { read(buffer: Buffer): DecodedPng };
  };
}
