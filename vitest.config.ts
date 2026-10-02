import { defineConfig } from 'vitest/config';

// Make TEST_DATABASE_URL from a local .env available to integration tests.
try {
  process.loadEnvFile();
} catch {
  // no .env file: integration tests that need a database are skipped
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one test database; run files sequentially.
    fileParallelism: false,
  },
});
