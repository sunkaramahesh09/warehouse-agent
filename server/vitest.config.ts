import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false, // integration tests share one database
    testTimeout: 30000,
    env: { AGENT_MODE: 'deterministic', DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/warehouse_test' },
  },
});
