import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { createPool, type Db } from '../../src/shared/db.js';

export const TEST_BASE_URL = 'https://pl.test';

/** A pool that is never connected: pg only dials on the first query. For tests that must not hit a DB. */
export function unusedPool(): Db {
  return createPool('postgres://unused@127.0.0.1:1/unused_test');
}

/** The UI is off by default so results do not depend on whether `web/dist` was built. */
export function buildTestApp(overrides: Partial<BuildAppOptions> & { db: Db }) {
  return buildApp({ mode: 'all', baseUrl: TEST_BASE_URL, webRoot: false, ...overrides });
}
