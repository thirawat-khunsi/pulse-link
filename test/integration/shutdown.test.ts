import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();
const OWNER = '11111111-1111-4111-8111-111111111111';

function httpGet(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, headers: { 'user-agent': 'curl/8.4.0' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

describe.skipIf(!url)('graceful shutdown (requires TEST_DATABASE_URL)', () => {
  let db: Db;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
    await db.query(
      `INSERT INTO links (owner_token, code, target_url) VALUES ($1, 'shut01', 'https://example.com/')`,
      [OWNER],
    );
    vi.stubEnv('DATABASE_URL', url ?? '');
    vi.stubEnv('BASE_URL', 'https://pl.test');
    vi.stubEnv('APP_MODE', 'all');
    // Far longer than the test: only the shutdown drain can write these clicks.
    vi.stubEnv('CLICK_FLUSH_MS', '60000');
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db.end();
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s closes the server, drains the click buffer, then exits 0',
    async (signal) => {
      const before = new Set(process.listeners(signal));
      const exit = vi.fn();
      const { app } = await startServer({ port: 0, logger: false, exit });
      // Exactly the handler startServer bound (other listeners, e.g. the test runner's, untouched).
      const added = process.listeners(signal).filter((l) => !before.has(l));
      expect(added).toHaveLength(1);

      const { port } = app.server.address() as AddressInfo;
      for (let i = 0; i < 3; i++) expect(await httpGet(port, '/shut01')).toBe(302);
      expect((await db.query('SELECT 1 FROM clicks')).rowCount).toBe(0);

      added[0]?.(signal);
      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(0);
      });

      expect((await db.query('SELECT 1 FROM clicks')).rowCount).toBe(3);
      const { rows } = await db.query('SELECT click_count FROM links');
      expect(rows).toEqual([{ click_count: 3 }]);
      expect(app.server.listening).toBe(false);
      // Both signal handlers are removed so a second signal cannot run shutdown again.
      expect(process.listeners('SIGTERM').filter((l) => !before.has(l))).toHaveLength(0);
      expect(process.listeners('SIGINT').filter((l) => !before.has(l))).toHaveLength(0);
    },
  );
});
