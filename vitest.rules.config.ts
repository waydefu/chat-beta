import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/rules.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
