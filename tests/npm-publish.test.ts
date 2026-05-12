import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Create require function for loading package.json
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

describe("npm package configuration", () => {
  describe("package.json structure", () => {
    it("should have correct engines.node constraint", () => {
      expect(pkg.engines?.node).toBe(">=22.0.0");
    });

    it("should have files whitelist including dist and README", () => {
      expect(pkg.files).toBeDefined();
      expect(pkg.files).toContain("dist");
      // README.md should be included by default even if not in files array
      // but we test for it explicitly in tarball contents below
    });

    it("should have bin field pointing to dist/cli.js", () => {
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.reygent).toBe("./dist/cli.js");
    });

    it("should have main field pointing to dist output", () => {
      expect(pkg.main).toBe("./dist/cli.js");
    });

    it("should be ESM type module", () => {
      expect(pkg.type).toBe("module");
    });

    it("should have valid semver version", () => {
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/);
    });
  });

  describe("build output", () => {
    beforeAll(() => {
      // Ensure build is fresh
      execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });
    });

    it("should produce dist/cli.js entrypoint", () => {
      const cliPath = join(projectRoot, "dist/cli.js");
      expect(existsSync(cliPath)).toBe(true);
    });

    it("should have shebang in dist/cli.js", () => {
      const cliPath = join(projectRoot, "dist/cli.js");
      const content = readFileSync(cliPath, "utf-8");
      expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
    });

    it("should produce both CJS and ESM outputs", () => {
      const cjsPath = join(projectRoot, "dist/cli.cjs");
      const esmPath = join(projectRoot, "dist/cli.js");

      // ESM is primary (cli.js)
      expect(existsSync(esmPath)).toBe(true);
      // CJS should exist as .cjs
      expect(existsSync(cjsPath)).toBe(true);
    });

    it("should produce source maps", () => {
      const mapPath = join(projectRoot, "dist/cli.js.map");
      expect(existsSync(mapPath)).toBe(true);
    });
  });

  describe("version output", () => {
    beforeAll(() => {
      execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });
    });

    it("should output correct version with --version flag", () => {
      const binPath = join(projectRoot, "dist/cli.js");
      const output = execSync(`node "${binPath}" --version`, {
        cwd: projectRoot,
        encoding: "utf-8",
      }).trim();

      expect(output).toBe(pkg.version);
    });

    it("should output version with -V flag", () => {
      const binPath = join(projectRoot, "dist/cli.js");
      const output = execSync(`node "${binPath}" -V`, {
        cwd: projectRoot,
        encoding: "utf-8",
      }).trim();

      expect(output).toBe(pkg.version);
    });
  });

  describe("npm pack output validation", () => {
    let packOutput: string;
    let tarballPath: string;
    let extractDir: string;

    beforeAll(() => {
      // Clean any existing tarballs
      try {
        execSync("rm -f reygent-*.tgz", { cwd: projectRoot, stdio: "pipe" });
      } catch {
        // Ignore if no tarballs exist
      }

      // Run npm pack --dry-run (notices go to stderr, redirect to stdout to capture)
      packOutput = execSync("npm pack --dry-run 2>&1", {
        cwd: projectRoot,
        encoding: "utf-8",
      });

      // Also create actual tarball for inspection
      const packResult = execSync("npm pack", {
        cwd: projectRoot,
        encoding: "utf-8",
      }).trim();

      tarballPath = join(projectRoot, packResult);
      extractDir = join(projectRoot, "tmp-npm-pack-test");

      // Extract tarball
      if (existsSync(extractDir)) {
        rmSync(extractDir, { recursive: true, force: true });
      }
      mkdirSync(extractDir, { recursive: true });

      execSync(`tar -xzf "${tarballPath}" -C "${extractDir}"`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    });

    afterAll(() => {
      // Cleanup
      if (existsSync(extractDir)) {
        rmSync(extractDir, { recursive: true, force: true });
      }
      if (existsSync(tarballPath)) {
        rmSync(tarballPath, { force: true });
      }
    });

    it("should include dist/ directory in tarball", () => {
      // Check for dist files rather than directory listing format
      expect(packOutput).toMatch(/dist\/cli\.(js|cjs)/);
    });

    it("should include README.md in tarball", () => {
      // README.md may appear as "README.md" or just part of file list
      expect(packOutput).toMatch(/README\.md|readme/i);
    });

    it("should include package.json in tarball", () => {
      // Always present in npm pack output
      expect(packOutput).toMatch(/package\.json/);
    });

    it("should NOT include src/ directory in tarball", () => {
      expect(packOutput).not.toMatch(/\bsrc\//);
    });

    it("should NOT include tests/ directory in tarball", () => {
      expect(packOutput).not.toMatch(/\btests?\//);
    });

    it("should NOT include .reygent/ directory in tarball", () => {
      expect(packOutput).not.toMatch(/\.reygent\//);
    });

    it("should NOT include tsconfig.json in tarball", () => {
      expect(packOutput).not.toMatch(/\btsconfig\.json\b/);
    });

    it("should NOT include tsup.config.ts in tarball", () => {
      expect(packOutput).not.toMatch(/\btsup\.config\./);
    });

    it("should NOT include vitest config in tarball", () => {
      expect(packOutput).not.toMatch(/\bvitest\.config\./);
    });

    it("should NOT include .github/ directory in tarball", () => {
      expect(packOutput).not.toMatch(/\.github\//);
    });

    it("extracted tarball should have executable bin/reygent", () => {
      const packageDir = join(extractDir, "package");
      const binPath = join(packageDir, "dist/cli.js");

      expect(existsSync(binPath)).toBe(true);

      // Check file mode (should be executable)
      // On Unix systems, npm pack should preserve executable bit
      const stats = require("fs").statSync(binPath);
      const isExecutable = !!(stats.mode & 0o111);
      expect(isExecutable).toBe(true);
    });

    it("extracted tarball should contain all dist artifacts", () => {
      const packageDir = join(extractDir, "package");
      const distDir = join(packageDir, "dist");

      expect(existsSync(join(distDir, "cli.js"))).toBe(true);
      expect(existsSync(join(distDir, "cli.cjs"))).toBe(true);
      expect(existsSync(join(distDir, "cli.js.map"))).toBe(true);
    });

    it("extracted tarball should have README.md", () => {
      const packageDir = join(extractDir, "package");
      expect(existsSync(join(packageDir, "README.md"))).toBe(true);
    });

    it("extracted tarball should NOT have source files", () => {
      const packageDir = join(extractDir, "package");
      expect(existsSync(join(packageDir, "src"))).toBe(false);
      expect(existsSync(join(packageDir, "tests"))).toBe(false);
      expect(existsSync(join(packageDir, ".reygent"))).toBe(false);
    });

    it("npm pack output should match extracted tarball contents", () => {
      // Verify that files listed in npm pack dry-run output are actually in the tarball
      const packageDir = join(extractDir, "package");

      // If pack output mentions dist/cli.js, it should exist in extracted tarball
      if (packOutput.includes("dist/cli.js")) {
        expect(existsSync(join(packageDir, "dist/cli.js"))).toBe(true);
      }

      // If pack output mentions dist/cli.cjs, it should exist in extracted tarball
      if (packOutput.includes("dist/cli.cjs")) {
        expect(existsSync(join(packageDir, "dist/cli.cjs"))).toBe(true);
      }

      // If pack output mentions README, it should exist in extracted tarball
      if (packOutput.match(/README\.md|readme/i)) {
        expect(existsSync(join(packageDir, "README.md"))).toBe(true);
      }

      // Verify exclusions: if src/ NOT in pack output, it should NOT be in tarball
      if (!packOutput.includes("src/")) {
        expect(existsSync(join(packageDir, "src"))).toBe(false);
      }

      // Verify exclusions: if tests/ NOT in pack output, it should NOT be in tarball
      if (!packOutput.match(/\btests?\//)) {
        expect(existsSync(join(packageDir, "tests"))).toBe(false);
      }
    });
  });

  describe("GitHub Actions workflow integration", () => {
    it("should have CI workflow configured", () => {
      const workflowPath = join(projectRoot, ".github/workflows/main.yml");
      expect(existsSync(workflowPath)).toBe(true);

      const workflow = readFileSync(workflowPath, "utf-8");
      expect(workflow).toContain("npm run build");
      expect(workflow).toContain("npm test");
      expect(workflow).toContain("node-version: 22");
    });

    it("CI workflow should run on pull requests", () => {
      const workflowPath = join(projectRoot, ".github/workflows/main.yml");
      const workflow = readFileSync(workflowPath, "utf-8");

      expect(workflow).toContain("pull_request");
    });
  });

  describe(".npmignore exclusions", () => {
    it("should have .npmignore file", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      expect(existsSync(npmignorePath)).toBe(true);
    });

    it(".npmignore should exclude src/ directory", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      const content = readFileSync(npmignorePath, "utf-8");
      expect(content).toMatch(/^src\/?$/m);
    });

    it(".npmignore should exclude tests/ directory", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      const content = readFileSync(npmignorePath, "utf-8");
      expect(content).toMatch(/^tests?\/?$/m);
    });

    it(".npmignore should exclude .reygent/ directory", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      const content = readFileSync(npmignorePath, "utf-8");
      expect(content).toMatch(/^\.reygent\/?$/m);
    });

    it(".npmignore should exclude development config files", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      const content = readFileSync(npmignorePath, "utf-8");

      expect(content).toMatch(/tsconfig/);
      expect(content).toMatch(/tsup\.config/);
      expect(content).toMatch(/vitest/);
    });

    it(".npmignore should exclude .github directory", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      const content = readFileSync(npmignorePath, "utf-8");
      expect(content).toMatch(/^\.github\/?$/m);
    });

    it(".npmignore should exclude migration files", () => {
      const npmignorePath = join(projectRoot, ".npmignore");
      const content = readFileSync(npmignorePath, "utf-8");
      expect(content).toMatch(/migration/i);
    });
  });
});
