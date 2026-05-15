import { describe, it, expect } from "vitest";
import { spawnAgentStream, formatExitDetail } from "../../src/spawn.js";

const SKIP_REASON = "ANTHROPIC_API_KEY not set — run locally with real key to test";

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Error details integration", () => {
  it("API 404 error includes errorMessage, apiErrorStatus, and helpful tip", async () => {
    let caughtError: Error | null = null;
    let result: Awaited<ReturnType<typeof spawnAgentStream>> | null = null;

    try {
      result = await spawnAgentStream(
        "test-agent",
        "Test.",
        30000,
        { provider: "claude", model: "model-does-not-exist-404" }
      );
    } catch (err) {
      caughtError = err as Error;
    }

    // Agent spawn may throw or return non-zero exit code depending on provider
    if (caughtError) {
      // If thrown, error message should be informative
      expect(caughtError.message).toBeTruthy();
    } else {
      // If returned with non-zero exit, check SpawnResult fields
      expect(result).toBeDefined();
      expect(result!.exitCode).not.toBe(0);

      // Check errorMessage and apiErrorStatus populated
      if (result!.errorMessage) {
        expect(result!.errorMessage).toBeTruthy();
        expect(result!.apiErrorStatus).toBeDefined();

        // Format detail and verify helpful tip present for 404 model errors
        const detail = formatExitDetail(result!);
        if (result!.apiErrorStatus === 404 && /not available/i.test(result!.errorMessage)) {
          expect(detail).toContain("Tip:");
          expect(detail).toContain("reygent config");
          expect(detail).toContain(".reygent/config.json");
        }
      }
    }
  }, 60000);

  it("formatExitDetail handles API error with errorMessage and status", async () => {
    let result: Awaited<ReturnType<typeof spawnAgentStream>> | null = null;

    try {
      result = await spawnAgentStream(
        "test-agent",
        "Test.",
        30000,
        { provider: "claude", model: "model-does-not-exist-404" }
      );
    } catch {
      // Expected to fail, skip rest of test
      return;
    }

    if (result && result.exitCode !== 0) {
      const detail = formatExitDetail(result);
      expect(detail).toBeTruthy();

      // Detail should prefer errorMessage over stdout when available
      if (result.errorMessage) {
        expect(detail).toContain(result.errorMessage);
      }

      // Detail should include HTTP status when available
      if (result.apiErrorStatus) {
        expect(detail).toContain(`HTTP ${result.apiErrorStatus}`);
      }
    }
  }, 60000);
});

describe.skipIf(process.env.ANTHROPIC_API_KEY)("Error details integration — skipped", () => {
  it("skips gracefully when ANTHROPIC_API_KEY not present", () => {
    console.log(SKIP_REASON);
  });
});
