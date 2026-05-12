import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    restoreMocks: true,
    mockReset: true,
    testTimeout: 60000, // 60s — provider calls can be slow
    hookTimeout: 60000,
  },
});
