import { loadDotEnv } from '../shared/config.js';
import { createPool } from '../shared/db.js';
import { runMigrations } from '../shared/migrate.js';

// Only DATABASE_URL is needed here, so the full app config is not required.
loadDotEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = createPool(url);
try {
  const applied = await runMigrations(pool);
  console.log(
    applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Database is already up to date',
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
