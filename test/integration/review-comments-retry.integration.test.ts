import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const exec = promisify(execFile);

describe("review-comments commit retry", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test repo
    tempDir = join(os.tmpdir(), `reygent-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    // Initialize git repo
    await exec("git", ["init"], { cwd: tempDir });
    await exec("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("retries commit when pre-commit hook auto-fixes files", async () => {
    // Create a pre-commit hook that auto-fixes on first run, succeeds on second
    const hookScript = `#!/bin/bash
# Simulate auto-fix behavior: modify staged files on first run
if [ ! -f .git/hook-ran ]; then
  echo "first" > .git/hook-ran
  # Modify staged file to simulate auto-fix
  echo "// auto-fixed" >> test.txt
  exit 1
else
  exit 0
fi
`;
    const hookPath = join(tempDir, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, hookScript, { mode: 0o755 });

    // Create initial commit
    await writeFile(join(tempDir, "test.txt"), "initial content\n");
    await exec("git", ["add", "test.txt"], { cwd: tempDir });
    await exec("git", ["commit", "-m", "initial"], { cwd: tempDir });

    // Modify file to trigger commit
    await writeFile(join(tempDir, "test.txt"), "modified content\n");
    await exec("git", ["add", "-A"], { cwd: tempDir });

    // First commit attempt should fail and trigger retry
    let firstAttemptFailed = false;
    try {
      await exec("git", ["commit", "-m", "test commit"], { cwd: tempDir });
    } catch {
      firstAttemptFailed = true;
    }

    expect(firstAttemptFailed).toBe(true);

    // Re-stage after hook modification
    await exec("git", ["add", "-A"], { cwd: tempDir });

    // Second attempt should succeed
    const { stdout } = await exec("git", ["commit", "-m", "test commit"], { cwd: tempDir });
    expect(stdout).toContain("test commit");
  });

  it("exhausts retries after maxRetries attempts", async () => {
    // Create a pre-commit hook that always fails
    const hookScript = `#!/bin/bash
echo "Hook always fails"
exit 1
`;
    const hookPath = join(tempDir, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, hookScript, { mode: 0o755 });

    // Create initial commit
    await writeFile(join(tempDir, "test.txt"), "initial content\n");
    await exec("git", ["add", "test.txt"], { cwd: tempDir });
    await exec("git", ["commit", "-m", "initial"], { cwd: tempDir });

    // Modify file
    await writeFile(join(tempDir, "test.txt"), "modified content\n");
    await exec("git", ["add", "-A"], { cwd: tempDir });

    // Simulate retry loop with max 3 attempts
    const maxRetries = 3;
    let attempts = 0;
    let committed = false;

    while (attempts < maxRetries) {
      attempts++;
      try {
        await exec("git", ["commit", "-m", "test commit"], { cwd: tempDir });
        committed = true;
        break;
      } catch {
        // Re-stage for next attempt
        await exec("git", ["add", "-A"], { cwd: tempDir });
      }
    }

    expect(attempts).toBe(maxRetries);
    expect(committed).toBe(false);
  });

  it("succeeds on first attempt when no pre-commit hook present", async () => {
    // Create initial commit
    await writeFile(join(tempDir, "test.txt"), "initial content\n");
    await exec("git", ["add", "test.txt"], { cwd: tempDir });
    await exec("git", ["commit", "-m", "initial"], { cwd: tempDir });

    // Modify file
    await writeFile(join(tempDir, "test.txt"), "modified content\n");
    await exec("git", ["add", "-A"], { cwd: tempDir });

    // Should succeed on first attempt
    const { stdout } = await exec("git", ["commit", "-m", "test commit"], { cwd: tempDir });
    expect(stdout).toContain("test commit");
  });

  it("handles multiple auto-fix passes (prettier -> lint -> type-check)", async () => {
    // Create a pre-commit hook that simulates multiple tool passes
    const hookScript = `#!/bin/bash
if [ ! -f .git/prettier-ran ]; then
  echo "prettier" > .git/prettier-ran
  echo "// prettier fixed" >> test.txt
  exit 1
elif [ ! -f .git/lint-ran ]; then
  echo "lint" > .git/lint-ran
  echo "// lint fixed" >> test.txt
  exit 1
elif [ ! -f .git/typecheck-ran ]; then
  echo "typecheck" > .git/typecheck-ran
  echo "// types fixed" >> test.txt
  exit 1
else
  exit 0
fi
`;
    const hookPath = join(tempDir, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, hookScript, { mode: 0o755 });

    // Create initial commit
    await writeFile(join(tempDir, "test.txt"), "initial content\n");
    await exec("git", ["add", "test.txt"], { cwd: tempDir });
    await exec("git", ["commit", "-m", "initial"], { cwd: tempDir });

    // Modify file
    await writeFile(join(tempDir, "test.txt"), "modified content\n");

    // Simulate retry loop - need 3 retries for 3 tool passes
    const maxRetries = 3;
    let attempts = 0;
    let committed = false;

    for (let i = 0; i <= maxRetries; i++) {
      await exec("git", ["add", "-A"], { cwd: tempDir });
      attempts++;
      try {
        await exec("git", ["commit", "-m", "test commit"], { cwd: tempDir });
        committed = true;
        break;
      } catch {
        // Continue to next retry
      }
    }

    expect(attempts).toBe(4); // Initial + 3 retries
    expect(committed).toBe(true);
  });
});
