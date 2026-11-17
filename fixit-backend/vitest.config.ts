import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Do not load .env files into the test process. tests/setup-env.ts sets a
  // complete dummy configuration before any application module is imported.
  envDir: false,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts'],
  },
});
