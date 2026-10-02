import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabaseUrl } from '../helpers/testDatabase.js';

const main = 'postgres://pulse:pulse@localhost:5432/pulse_link';
const test = 'postgres://pulse:pulse@localhost:5432/pulse_link_test';

const check = (testUrl: string, mainUrl: string | undefined) => () => {
  assertSafeTestDatabaseUrl(testUrl, mainUrl);
};

describe('assertSafeTestDatabaseUrl', () => {
  it('accepts a separate *_test database', () => {
    expect(check(test, main)).not.toThrow();
    expect(check(test, undefined)).not.toThrow();
    expect(check('postgresql://u@db:5433/app_test?sslmode=disable', main)).not.toThrow();
  });

  it('rejects a database name that does not end with _test', () => {
    expect(check(main, undefined)).toThrow(/must end with "_test"/);
    expect(check('postgres://u@localhost/pulse_test_backup', undefined)).toThrow(/_test/);
    expect(check('postgres://u@localhost', undefined)).toThrow(/_test/);
  });

  it('rejects the same database as DATABASE_URL', () => {
    expect(check(test, test)).toThrow(/same database/);
    // Same host, port and database written differently (other credentials, default port, host case).
    expect(check(test, 'postgresql://other:secret@LOCALHOST/pulse_link_test')).toThrow(
      /same database/,
    );
  });

  it('rejects URLs that are not postgres URLs', () => {
    expect(check('not a url', main)).toThrow(/not a valid/);
    expect(check('mysql://u@localhost/x_test', main)).toThrow(/not a valid/);
  });
});
