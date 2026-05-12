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
    // maxForks=2: Integration tests make real API calls and spawn child processes,
    // consuming more memory/CPU than unit tests. Lower limit prevents resource exhaustion
    // and flaky timeouts. Adjust via VITEST_INTEGRATION_MAX_FORKS env var if needed.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: Number(process.env.VITEST_INTEGRATION_MAX_FORKS) || 2,
      },
    },
    fileParallelism: true,
    maxConcurrency: 3,
  },
});
