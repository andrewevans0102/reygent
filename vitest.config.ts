import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/smoke/**/*.test.ts"],
    restoreMocks: true,
    mockReset: true,
    // Limit parallelism to prevent resource exhaustion
    // maxForks=4: Balances test speed with stability. Higher values (8+) caused timeouts
    // in CI environments due to memory/CPU contention. Value tuned for GitHub Actions runners
    // with 7GB RAM / 2-core CPUs. Adjust via VITEST_MAX_FORKS env var if needed.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: Number(process.env.VITEST_MAX_FORKS) || 4,
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
