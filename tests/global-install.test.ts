import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

describe("global installation simulation", () => {
  let testPrefix: string;
  let tarballPath: string;

  beforeAll(() => {
    // Create isolated npm prefix for testing global install
    testPrefix = join(projectRoot, "tmp-global-test");
    if (existsSync(testPrefix)) {
      rmSync(testPrefix, { recursive: true, force: true });
    }
    mkdirSync(testPrefix, { recursive: true });

    // Build fresh package
    execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });

    // Create tarball - npm pack output may contain notices, extract just filename
    const packOutput = execSync("npm pack", {
      cwd: projectRoot,
      encoding: "utf-8",
    });

    // Extract tarball filename from output (last line, may have notices before)
    const packResult = packOutput.trim().split("\n").pop() || "";

    // Verify filename matches expected pattern
    expect(packResult).toMatch(/^reygent-.*\.tgz$/);

    tarballPath = join(projectRoot, packResult);
    expect(existsSync(tarballPath)).toBe(true);
  });

  afterAll(() => {
    // Cleanup
    if (existsSync(testPrefix)) {
      rmSync(testPrefix, { recursive: true, force: true });
    }
    if (existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
  });

  it("should install globally from tarball", () => {
    const env = {
      ...process.env,
      npm_config_prefix: testPrefix,
      PATH: `${join(testPrefix, "bin")}:${process.env.PATH}`,
    };

    // Install from local tarball
    execSync(`npm install -g "${tarballPath}"`, {
      cwd: projectRoot,
      env,
      stdio: "pipe",
    });

    // Verify bin was installed
    const binPath = join(testPrefix, "bin", "reygent");
    expect(existsSync(binPath)).toBe(true);
  });

  it("installed binary should be executable", () => {
    const binPath = join(testPrefix, "bin", "reygent");
    expect(existsSync(binPath)).toBe(true);

    // Check executable bit
    const stats = require("fs").statSync(binPath);
    const isExecutable = !!(stats.mode & 0o111);
    expect(isExecutable).toBe(true);
  });

  it("installed binary should output version", () => {
    const env = {
      ...process.env,
      npm_config_prefix: testPrefix,
      PATH: `${join(testPrefix, "bin")}:${process.env.PATH}`,
    };

    const output = execSync("reygent --version", {
      cwd: testPrefix,
      env,
      encoding: "utf-8",
    }).trim();

    expect(output).toBe(pkg.version);
  });

  it("installed binary should be callable with -V flag", () => {
    const env = {
      ...process.env,
      npm_config_prefix: testPrefix,
      PATH: `${join(testPrefix, "bin")}:${process.env.PATH}`,
    };

    const output = execSync("reygent -V", {
      cwd: testPrefix,
      env,
      encoding: "utf-8",
    }).trim();

    expect(output).toBe(pkg.version);
  });

  it("installed binary should show help with --help", () => {
    const env = {
      ...process.env,
      npm_config_prefix: testPrefix,
      PATH: `${join(testPrefix, "bin")}:${process.env.PATH}`,
    };

    const output = execSync("reygent --help", {
      cwd: testPrefix,
      env,
      encoding: "utf-8",
    });

    expect(output).toContain("Usage:");
    expect(output).toContain("reygent");
  });

  it("installed package should only contain dist/ and package.json", () => {
    const libPath = join(testPrefix, "lib", "node_modules", "reygent");
    expect(existsSync(libPath)).toBe(true);

    // Should have dist/
    expect(existsSync(join(libPath, "dist"))).toBe(true);

    // Should have package.json
    expect(existsSync(join(libPath, "package.json"))).toBe(true);

    // Should have README.md
    expect(existsSync(join(libPath, "README.md"))).toBe(true);

    // Should NOT have src/
    expect(existsSync(join(libPath, "src"))).toBe(false);

    // Should NOT have tests/
    expect(existsSync(join(libPath, "tests"))).toBe(false);

    // Should NOT have .reygent/
    expect(existsSync(join(libPath, ".reygent"))).toBe(false);

    // Should NOT have tsconfig
    expect(existsSync(join(libPath, "tsconfig.json"))).toBe(false);

    // Should NOT have tsup config
    expect(existsSync(join(libPath, "tsup.config.ts"))).toBe(false);

    // Should NOT have .github/
    expect(existsSync(join(libPath, ".github"))).toBe(false);
  });

  it("installed package.json should match source version", () => {
    const libPath = join(testPrefix, "lib", "node_modules", "reygent");
    const installedPkg = JSON.parse(
      readFileSync(join(libPath, "package.json"), "utf-8")
    );

    expect(installedPkg.version).toBe(pkg.version);
    expect(installedPkg.name).toBe(pkg.name);
  });

  it("installed dist/ should contain all build artifacts", () => {
    const libPath = join(testPrefix, "lib", "node_modules", "reygent");
    const distPath = join(libPath, "dist");

    // Should have ESM entry
    expect(existsSync(join(distPath, "cli.js"))).toBe(true);

    // Should have CJS entry
    expect(existsSync(join(distPath, "cli.cjs"))).toBe(true);

    // Should have source map
    expect(existsSync(join(distPath, "cli.js.map"))).toBe(true);
  });

  it("installed bin should have shebang", () => {
    const binPath = join(testPrefix, "bin", "reygent");
    const content = readFileSync(binPath, "utf-8");

    // npm creates wrapper script with shebang
    expect(content).toMatch(/^#!.*node/);
  });

  it("should work when installed to custom prefix", () => {
    const customPrefix = join(projectRoot, "tmp-custom-prefix");

    if (existsSync(customPrefix)) {
      rmSync(customPrefix, { recursive: true, force: true });
    }
    mkdirSync(customPrefix, { recursive: true });

    // Create own tarball to avoid race conditions with parallel tests
    const customPackOutput = execSync("npm pack", {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    const customTarballResult = customPackOutput.trim().split("\n").pop() || "";
    const customTarballPath = join(projectRoot, customTarballResult);

    const env = {
      ...process.env,
      npm_config_prefix: customPrefix,
      PATH: `${join(customPrefix, "bin")}:${process.env.PATH}`,
    };

    try {
      execSync(`npm install -g "${customTarballPath}"`, {
        cwd: projectRoot,
        env,
        stdio: "pipe",
      });

      const output = execSync("reygent --version", {
        cwd: customPrefix,
        env,
        encoding: "utf-8",
      }).trim();

      expect(output).toBe(pkg.version);
    } finally {
      if (existsSync(customPrefix)) {
        rmSync(customPrefix, { recursive: true, force: true });
      }
      if (existsSync(customTarballPath)) {
        rmSync(customTarballPath, { force: true });
      }
    }
  });

  it("should uninstall cleanly", () => {
    const env = {
      ...process.env,
      npm_config_prefix: testPrefix,
      PATH: `${join(testPrefix, "bin")}:${process.env.PATH}`,
    };

    execSync("npm uninstall -g reygent", {
      cwd: projectRoot,
      env,
      stdio: "pipe",
    });

    const binPath = join(testPrefix, "bin", "reygent");
    expect(existsSync(binPath)).toBe(false);
  });
});

describe("package installation edge cases", () => {
  it("should handle reinstallation without errors", { timeout: 10000 }, () => {
    const testPrefix = join(projectRoot, "tmp-reinstall-test");
    if (existsSync(testPrefix)) {
      rmSync(testPrefix, { recursive: true, force: true });
    }
    mkdirSync(testPrefix, { recursive: true });

    try {
      // Build and pack
      execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });
      const packOutput = execSync("npm pack", {
        cwd: projectRoot,
        encoding: "utf-8",
      });
      const packResult = packOutput.trim().split("\n").pop() || "";
      const tarballPath = join(projectRoot, packResult);

      const env = {
        ...process.env,
        npm_config_prefix: testPrefix,
        PATH: `${join(testPrefix, "bin")}:${process.env.PATH}`,
      };

      // Install twice
      execSync(`npm install -g "${tarballPath}"`, {
        cwd: projectRoot,
        env,
        stdio: "pipe",
      });

      execSync(`npm install -g "${tarballPath}"`, {
        cwd: projectRoot,
        env,
        stdio: "pipe",
      });

      // Should still work
      const output = execSync("reygent --version", {
        cwd: testPrefix,
        env,
        encoding: "utf-8",
      }).trim();

      expect(output).toBe(pkg.version);

      // Cleanup
      if (existsSync(tarballPath)) {
        rmSync(tarballPath, { force: true });
      }
    } finally {
      if (existsSync(testPrefix)) {
        rmSync(testPrefix, { recursive: true, force: true });
      }
    }
  });

  it("should work with npm link during development", () => {
    const testLinkPrefix = join(projectRoot, "tmp-link-test");
    if (existsSync(testLinkPrefix)) {
      rmSync(testLinkPrefix, { recursive: true, force: true });
    }
    mkdirSync(testLinkPrefix, { recursive: true });

    try {
      execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });

      const env = {
        ...process.env,
        npm_config_prefix: testLinkPrefix,
        PATH: `${join(testLinkPrefix, "bin")}:${process.env.PATH}`,
      };

      // Link globally
      execSync("npm link", {
        cwd: projectRoot,
        env,
        stdio: "pipe",
      });

      const output = execSync("reygent --version", {
        cwd: testLinkPrefix,
        env,
        encoding: "utf-8",
      }).trim();

      expect(output).toBe(pkg.version);

      // Unlink
      execSync("npm unlink -g reygent", {
        cwd: projectRoot,
        env,
        stdio: "pipe",
      });
    } finally {
      if (existsSync(testLinkPrefix)) {
        rmSync(testLinkPrefix, { recursive: true, force: true });
      }
    }
  });
});
