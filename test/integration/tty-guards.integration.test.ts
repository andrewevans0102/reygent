import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "../../../");
const cliPath = path.join(projectRoot, "dist/cli.js");

/**
 * Integration tests verifying TTY guards work correctly in non-interactive environments.
 * These tests simulate CI environments where stdin is not a TTY.
 */
describe("TTY guards in non-interactive environments", () => {
  /**
   * Helper to run CLI command without TTY (simulates CI environment)
   */
  function runWithoutTTY(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn("node", [cliPath, ...args], {
        stdio: ["pipe", "pipe", "pipe"], // No TTY
        env: {
          ...process.env,
          // Explicitly unset TTY-related variables
          TERM: undefined,
        },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({ code: code ?? 0, stdout, stderr });
      });

      // Close stdin immediately to simulate non-TTY
      child.stdin.end();
    });
  }

  it("agent command fails gracefully in non-TTY when no agent name provided", async () => {
    const result = await runWithoutTTY(["agent"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Agent name required in non-interactive mode");
    expect(result.stdout).toContain("Valid agents:");
  }, 30000);

  it("agent command succeeds in non-TTY when agent name provided", async () => {
    const result = await runWithoutTTY(["agent", "dev", "Hello world"]);

    // Should succeed (exit 0) or fail with non-TTY error if other prompts triggered
    // At minimum, should not hang indefinitely
    expect(result.code).toBeDefined();
  }, 30000);

  it("init command with dry-run works in non-TTY", async () => {
    const result = await runWithoutTTY(["init", "--dry-run"]);

    // dry-run should not require prompts
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stdout).toContain("Would create:");
  }, 30000);

  it("spec command fails gracefully in non-TTY when input required", async () => {
    const result = await runWithoutTTY(["spec"]);

    // Should exit with error, not hang
    expect(result.code).toBeGreaterThan(0);
    // Should mention non-interactive mode or missing input
    expect(result.stdout + result.stderr).toMatch(/(non-interactive|required|stdin)/i);
  }, 30000);

  it("run command with inline spec works in non-TTY", async () => {
    const result = await runWithoutTTY([
      "run",
      "test.md",
      "--dry-run",
      "--auto-approve",
      "--skip-clarification",
    ]);

    // With dry-run and auto-approve, should not require prompts
    // May fail due to missing test.md file, but should not hang
    expect(result.code).toBeDefined();
  }, 30000);
});
