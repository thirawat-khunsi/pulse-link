import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Db } from '../../src/shared/db.js';
import { runMigrations } from '../../src/shared/migrate.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('runMigrations (requires TEST_DATABASE_URL)', () => {
  let db: Db;

  beforeAll(async () => {
    db = createPool(url ?? '');
    await db.query('DROP TABLE IF EXISTS clicks, links, schema_migrations CASCADE');
  });

  afterAll(async () => {
    await db.end();
  });

  it('applies 001_init once and is idempotent', async () => {
    expect(await runMigrations(db)).toEqual(['001_init.sql']);
    expect(await runMigrations(db)).toEqual([]);
  });

  it('creates the SPEC §3 schema with its constraints and indexes', async () => {
    const { rows: indexes } = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('links','clicks') ORDER BY 1",
    );
    expect(indexes.map((r) => r.indexname)).toEqual([
      'clicks_pkey',
      'idx_clicks_link_time',
      'idx_links_owner',
      'links_code_key',
      'links_pkey',
    ]);

    const owner = '00000000-0000-4000-8000-000000000000';
    const {
      rows: [link],
    } = await db.query<{ id: string; click_count: number; is_active: boolean }>(
      `INSERT INTO links (owner_token, code, target_url) VALUES ($1, 'กาแฟ', 'https://example.com/')
       RETURNING id, click_count, is_active`,
      [owner],
    );
    expect(link).toMatchObject({ click_count: 0, is_active: true });

    await expect(
      db.query(`INSERT INTO links (owner_token, code, target_url) VALUES ($1, 'กาแฟ', 'x')`, [
        owner,
      ]),
    ).rejects.toMatchObject({ code: '23505' }); // unique_violation
    await expect(
      db.query(
        `INSERT INTO links (owner_token, code, target_url, max_clicks) VALUES ($1, 'zero', 'x', 0)`,
        [owner],
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
    await expect(
      db.query(`INSERT INTO clicks (link_id, source) VALUES ($1, 'email')`, [link?.id]),
    ).rejects.toMatchObject({ code: '23514' });

    await db.query(`INSERT INTO clicks (link_id, source) VALUES ($1, 'qr')`, [link?.id]);
    await db.query('DELETE FROM links WHERE id = $1', [link?.id]);
    const { rows: left } = await db.query('SELECT 1 FROM clicks');
    expect(left).toHaveLength(0); // ON DELETE CASCADE
  });
});
