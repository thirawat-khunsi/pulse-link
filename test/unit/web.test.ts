import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, unusedPool } from '../helpers/app.js';

let webRoot: string;
const INDEX = '<!doctype html><title>Pulse Link</title><div id="root"></div>';

beforeAll(() => {
  webRoot = mkdtempSync(join(tmpdir(), 'pl-web-'));
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'index.html'), INDEX);
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1)');
});

afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true });
});

describe('web UI (D-006)', () => {
  it.each(['all', 'api'] as const)('mode=%s serves index.html at /', async (mode) => {
    const app = buildTestApp({ mode, db: unusedPool(), webRoot });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX);
    await app.close();
  });

  it('serves hashed assets with an immutable cache', async () => {
    const app = buildTestApp({ db: unusedPool(), webRoot });
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    await app.close();
  });

  it('a missing asset is a 404, not a redirect lookup', async () => {
    const app = buildTestApp({ db: unusedPool(), webRoot });
    const res = await app.inject({ method: 'GET', url: '/assets/nope.js' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('mode=redirect does not serve the UI', async () => {
    const app = buildTestApp({ mode: 'redirect', db: unusedPool(), webRoot });
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })).statusCode).toBe(
      404,
    );
    await app.close();
  });

  it('answers 503 with a Thai page when the UI is not built', async () => {
    const app = buildTestApp({ db: unusedPool(), webRoot: join(webRoot, 'missing') });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('ยังไม่ได้ build หน้าเว็บ');
    await app.close();
  });

  it('keeps upgrade-insecure-requests only for https deployments', async () => {
    const https = buildTestApp({ db: unusedPool(), webRoot });
    const http = buildTestApp({ db: unusedPool(), webRoot, baseUrl: 'http://localhost:3000' });
    const cspOf = async (app: typeof https) =>
      String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy']);
    expect(await cspOf(https)).toContain('upgrade-insecure-requests');
    expect(await cspOf(http)).not.toContain('upgrade-insecure-requests');
    expect(await cspOf(http)).toContain("script-src 'self'");
    await Promise.all([https.close(), http.close()]);
  });
});
