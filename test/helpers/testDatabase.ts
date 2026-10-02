/**
 * Refuses to hand out a test database URL that could point at real data. Integration tests drop and
 * truncate tables, so this must run before any connection is opened.
 */
export function assertSafeTestDatabaseUrl(testUrl: string, mainUrl: string | undefined): void {
  const test = parseTarget(testUrl);
  if (!test) {
    throw new Error(
      'TEST_DATABASE_URL is not a valid postgres URL; refusing to run integration tests',
    );
  }
  if (!test.database.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL database "${test.database}" must end with "_test"; refusing to run integration tests`,
    );
  }
  if (mainUrl) {
    const main = parseTarget(mainUrl);
    if (testUrl === mainUrl || (main && sameTarget(test, main))) {
      throw new Error(
        'TEST_DATABASE_URL points at the same database as DATABASE_URL; refusing to run integration tests',
      );
    }
  }
}

interface Target {
  host: string;
  port: string;
  database: string;
}

function parseTarget(raw: string): Target | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

function sameTarget(a: Target, b: Target): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

/**
 * `TEST_DATABASE_URL` after the safety check, or undefined when unset (DB tests are skipped).
 * Call at the top level of every integration test file so a bad URL fails before any query runs.
 */
export function getTestDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (url) assertSafeTestDatabaseUrl(url, process.env.DATABASE_URL);
  return url;
}
