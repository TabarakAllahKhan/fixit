import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Do not load .env files into the test process. tests/setup-env.ts sets a
  // complete dummy configuration before any application module is imported.
  envDir: false,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Database tests have their own runner (vitest.db.config.ts); keep this suite DB-free.
    exclude: [...configDefaults.exclude, 'tests/db/**'],
    setupFiles: ['./tests/setup-env.ts'],
  },
});
