import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, rm, readdir } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "../../../");
const cliPath = path.join(projectRoot, "dist/cli.js");

describe("CLI smoke tests", () => {
  it("reygent --help exits 0", async () => {
    const { stdout, stderr } = await execFileAsync("node", [cliPath, "--help"]);
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  }, 10000);

  it("reygent --version exits 0 and prints version", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "--version"]);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 10000);

  it("reygent run without --spec exits non-zero", async () => {
    try {
      await execFileAsync("node", [cliPath, "run"]);
      expect.fail("Expected command to fail");
    } catch (err: any) {
      expect(err.code).toBeGreaterThan(0);
      expect(err.stderr || err.stdout).toMatch(/spec|required/i);
    }
  }, 10000);

  it("reygent agent without agent name exits non-zero", async () => {
    try {
      await execFileAsync("node", [cliPath, "agent"]);
      expect.fail("Expected command to fail");
    } catch (err: any) {
      expect(err.code).toBeGreaterThan(0);
      expect(err.stderr || err.stdout).toMatch(/agent|required/i);
    }
  }, 10000);

  it("reygent config in non-interactive mode exits non-zero", async () => {
    try {
      await execFileAsync("node", [cliPath, "config"]);
      expect.fail("Expected command to fail");
    } catch (err: any) {
      expect(err.code).toBeGreaterThan(0);
      expect(err.stderr || err.stdout).toMatch(/interactive|config/i);
    }
  }, 10000);

  it("reygent init runs without error", async () => {
    const tempDir = path.join(projectRoot, "tmp-smoke-init");
    await mkdir(tempDir, { recursive: true });

    try {
      await execFileAsync("node", [cliPath, "init"], {
        cwd: tempDir,
      });

      const reygentDir = path.join(tempDir, ".reygent");
      const dirContents = await readdir(reygentDir);
      expect(dirContents).toContain("config.json");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 10000);
});
