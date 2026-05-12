import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    restoreMocks: true,
    mockReset: true,
    testTimeout: 120000, // 120s — provider calls can be slow
    hookTimeout: 120000,
    // Limit parallelism for integration tests
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 2, // Integration tests are heavier, use fewer workers
      },
    },
    fileParallelism: true,
    maxConcurrency: 3,
  },
});
