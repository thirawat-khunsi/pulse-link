import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClickRow } from '../../src/modules/clicks/buffer.js';
import { createClickWriter } from '../../src/modules/clicks/repository.js';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';
import { getTestDatabaseUrl } from '../helpers/testDatabase.js';

const url = getTestDatabaseUrl();
const OWNER = '11111111-1111-4111-8111-111111111111';

function row(linkId: number, extra: Partial<ClickRow> = {}): ClickRow {
  return {
    linkId,
    clickedAt: new Date('2026-10-01T12:00:00Z'),
    source: 'click',
    device: 'mobile',
    browser: 'Chrome',
    os: 'Android',
    referrerHost: null,
    isBot: false,
    counted: false,
    ...extra,
  };
}

describe.skipIf(!url)('click writer (requires TEST_DATABASE_URL)', () => {
  let db: Db;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await runMigrations(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE links, clicks RESTART IDENTITY CASCADE');
    await db.query(
      `INSERT INTO links (owner_token, code, target_url)
       VALUES ($1, 'aaa', 'https://a.example'), ($1, 'bbb', 'https://b.example')`,
      [OWNER],
    );
  });

  afterAll(async () => {
    await db.end();
  });

  it('inserts rows and adds non-bot, not-yet-counted visits to click_count', async () => {
    await createClickWriter(db).write([
      row(1, { source: 'qr', referrerHost: 'line.me', browser: null, os: null }),
      row(1),
      row(1, { isBot: true, device: 'bot' }),
      row(1, { counted: true }), // already counted by the atomic max_clicks UPDATE
      row(2),
    ]);

    const { rows: counts } = await db.query('SELECT id, click_count FROM links ORDER BY id');
    expect(counts).toEqual([
      { id: '1', click_count: 2 },
      { id: '2', click_count: 1 },
    ]);
    const { rows: clicks } = await db.query<{ source: string }>(
      `SELECT link_id, clicked_at, source, device, browser, os, referrer_host, is_bot
         FROM clicks ORDER BY id`,
    );
    expect(clicks).toHaveLength(5);
    // JOIN does not preserve input order; find the QR row.
    expect(clicks.find((c) => c.source === 'qr')).toEqual({
      link_id: '1',
      clicked_at: new Date('2026-10-01T12:00:00Z'),
      source: 'qr',
      device: 'mobile',
      browser: null,
      os: null,
      referrer_host: 'line.me',
      is_bot: false,
    });
  });

  it('drops rows of links deleted before the flush without failing the batch', async () => {
    await db.query('DELETE FROM links WHERE id = 2');
    await createClickWriter(db).write([row(1), row(2), row(999)]);
    const { rows } = await db.query('SELECT link_id FROM clicks');
    expect(rows).toEqual([{ link_id: '1' }]);
    const { rows: counts } = await db.query('SELECT click_count FROM links');
    expect(counts).toEqual([{ click_count: 1 }]);
  });

  it('writes nothing for an empty batch', async () => {
    await createClickWriter(db).write([]);
    expect((await db.query('SELECT 1 FROM clicks')).rowCount).toBe(0);
  });
});
