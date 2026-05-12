import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    mockReset: true,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: Number(process.env.VITEST_MAX_FORKS) || 4,
      },
    },
    fileParallelism: true,
    maxConcurrency: 5,
  },
});
