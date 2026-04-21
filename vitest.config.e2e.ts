import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ['tests/e2e/setup.ts'],
    teardownTimeout: 120_000,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
