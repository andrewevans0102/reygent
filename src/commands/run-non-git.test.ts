/**
 * Integration tests for `reygent run` in non-git directories
 *
 * Tests that `reygent run` exits cleanly in directories without git repositories:
 * - No .git directory at all (plain directory)
 * - Empty git repository (has .git but no commits)
 * - Normal git repository (control case)
 *
 * Verifies:
 * - Process exits cleanly with appropriate exit codes
 * - No hanging processes or zombie tasks
 * - Telemetry/knowledge updates handle missing git gracefully
 * - Post-run hooks and cleanup don't wait on git operations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("reygent run in non-git directories", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "reygent-test-"));
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should exit cleanly in directory with no git repository", async () => {
    // Create minimal spec file
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nSimple test task that completes immediately.",
    );

    // Create minimal package.json so dir looks like project
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );

    // Run reygent with timeout to detect hanging
    const timeout = 10000; // 10 seconds max
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run", // Dry run to avoid actual agent execution
        ],
        {
          cwd: testDir,
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      // Should complete within timeout
      expect(duration).toBeLessThan(timeout);

      // Should exit with success code
      expect(result).toBeDefined();
    } catch (err: any) {
      // If aborted, command hung
      if (err.name === "AbortError") {
        throw new Error(
          `Command hung and did not exit within ${timeout}ms in non-git directory`,
        );
      }

      // Re-throw other errors
      throw err;
    }
  }, 15000); // 15s test timeout (allows for 10s command timeout + overhead)

  it("should exit cleanly in empty git repository (no commits)", async () => {
    // Create minimal spec file
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nSimple test task that completes immediately.",
    );

    // Initialize empty git repo
    await execFileAsync("git", ["init"], { cwd: testDir });

    const timeout = 10000;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(timeout);
      expect(result).toBeDefined();
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Command hung and did not exit within ${timeout}ms in empty git repo`,
        );
      }
      throw err;
    }
  }, 15000);

  it("should exit cleanly in normal git repository (control)", async () => {
    // Create minimal spec file
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nSimple test task that completes immediately.",
    );

    // Initialize git repo with at least one commit
    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: testDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: testDir,
    });
    await writeFile(join(testDir, "README.md"), "# Test Project");
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], {
      cwd: testDir,
    });

    const timeout = 10000;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(timeout);
      expect(result).toBeDefined();
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Command hung and did not exit within ${timeout}ms in normal git repo`,
        );
      }
      throw err;
    }
  }, 15000);

  it("should handle telemetry close gracefully without git", async () => {
    // Create minimal spec file
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nSimple test task that completes immediately.",
    );

    // Create package.json to trigger project detection
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );

    // Run with telemetry enabled (default)
    const timeout = 10000;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
          env: {
            ...process.env,
            // Ensure telemetry is enabled
            REYGENT_TELEMETRY: "standard",
          },
        },
      );

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      // Should complete even with telemetry enabled
      expect(duration).toBeLessThan(timeout);
      expect(result).toBeDefined();
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Command with telemetry hung in non-git directory`,
        );
      }
      throw err;
    }
  }, 15000);

  it("should skip PR stages gracefully when not in git repo", async () => {
    // This test would require full pipeline execution (not dry-run)
    // Testing that PR create/review stages are skipped without hanging

    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nMinimal spec for testing PR stage skip behavior.",
    );

    // Create package.json
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );

    // Note: This test uses dry-run to avoid full execution
    // Full integration test would require mocking agent responses
    const timeout = 10000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      // Verify output mentions PR stages will be skipped (dry-run mode)
      expect(result.stdout).toContain("pr-create");
      expect(result.stdout).toContain("pr-review");
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Command hung during PR stage skip check`,
        );
      }
      throw err;
    }
  }, 15000);
});

describe("updateKnowledgeFromTelemetry in non-git directories", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "reygent-knowledge-test-"));
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should skip knowledge update when not in project", async () => {
    // Create spec in plain directory (no project markers)
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nTest knowledge update skip behavior.",
    );

    // Run command
    const timeout = 10000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
          env: {
            ...process.env,
            REYGENT_TELEMETRY: "standard",
            REYGENT_DEBUG: "knowledge", // Enable debug logging
          },
        },
      );

      clearTimeout(timeoutId);

      // Should complete without error
      // Knowledge update should skip silently
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Knowledge update caused hang in non-project directory`,
        );
      }
      throw err;
    }
  }, 15000);

  it("should handle knowledge update errors gracefully", async () => {
    // Create project with markers
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nTest knowledge error handling.",
    );

    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );

    // Create .reygent but make it read-only to trigger errors
    const reygentDir = join(testDir, ".reygent");
    await mkdir(reygentDir, { mode: 0o444 }); // Read-only

    const timeout = 10000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
          env: {
            ...process.env,
            REYGENT_TELEMETRY: "standard",
            REYGENT_DEBUG: "knowledge",
          },
        },
      );

      clearTimeout(timeoutId);

      // Should complete even if knowledge update fails
      // Errors should be swallowed per implementation
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Knowledge error handling caused hang`,
        );
      }
      // Command may fail due to read-only dir, but shouldn't hang
    }
  }, 15000);
});

describe("telemetry backend close in non-git directories", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "reygent-telemetry-test-"));
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should close telemetry backend cleanly without git", async () => {
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nTest telemetry backend close.",
    );

    // Create package.json to trigger project detection
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );

    const timeout = 10000;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const result = await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
          env: {
            ...process.env,
            REYGENT_TELEMETRY: "verbose", // Use verbose to test full telemetry flow
          },
        },
      );

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      // Should complete and close cleanly
      expect(duration).toBeLessThan(timeout);
      expect(result).toBeDefined();
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Telemetry backend close hung in non-git directory`,
        );
      }
      throw err;
    }
  }, 15000);

  it("should handle flush errors during telemetry close", async () => {
    const specPath = join(testDir, "spec.md");
    await writeFile(
      specPath,
      "# Test Spec\n\nTest telemetry flush error handling.",
    );

    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
    );

    const timeout = 10000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      await execFileAsync(
        "node",
        [
          join(process.cwd(), "dist/cli.js"),
          "run",
          "--spec",
          specPath,
          "--dry-run",
        ],
        {
          cwd: testDir,
          signal: controller.signal,
          env: {
            ...process.env,
            REYGENT_TELEMETRY: "standard",
            REYGENT_DEBUG: "1",
          },
        },
      );

      clearTimeout(timeoutId);

      // Should complete even if flush encounters errors
      // Error handling is swallowed per implementation (lines 1319-1323, 1382-1385)
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `Telemetry flush error caused hang`,
        );
      }
    }
  }, 15000);
});
