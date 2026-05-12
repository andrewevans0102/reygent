import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/smoke/**/*.test.ts"],
    restoreMocks: true,
    mockReset: true,
    // Limit parallelism to prevent resource exhaustion
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 4, // Limit concurrent workers
      },
    },
    fileParallelism: true,
    maxConcurrency: 5, // Limit concurrent tests per file
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/cli.ts",
        "src/commands/**",
        "src/spawn.ts",
        "src/implement.ts",
        "src/generate-spec.ts",
      ],
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 75,
        statements: 55,
      },
    },
  },
});
