import { defineConfig } from 'vitest/config';

// Separate runner for database integration tests. This config deliberately does not
// load any .env file: tests/db/setup-db-env.ts loads only .env.test after its guards
// pass, so the normal DB-free suite and the development .env are never involved.
export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts', './tests/db/setup-db-env.ts'],
    // DB tests share one isolated database; keep them serial to avoid fixture races.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
