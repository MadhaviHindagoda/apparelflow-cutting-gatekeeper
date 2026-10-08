import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    fileParallelism: false, // integration tests share one real database
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
