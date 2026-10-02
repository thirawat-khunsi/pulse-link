import pg from 'pg';

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client error must not crash the process; the pool replaces the client.
  pool.on('error', (err) => {
    console.error('postgres idle client error', err);
  });
  return pool;
}
