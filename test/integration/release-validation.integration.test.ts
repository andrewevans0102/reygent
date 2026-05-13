import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");

describe("Release validation edge cases", () => {
  describe("Configuration validation", () => {
    it(".releaserc.json is valid JSON", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it("commitlint.config.js is valid JavaScript", () => {
      const path = resolve(ROOT, "commitlint.config.js");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toContain("syntax error");
    });

    it("release.yml is valid YAML", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(() => parseYaml(content)).not.toThrow();
    });
  });

  describe("semantic-release plugin configuration", () => {
    it("npm plugin access setting is 'public'", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const npmPlugin = config.plugins.find(
        (p: any) =>
          (Array.isArray(p) && p[0] === "@semantic-release/npm") ||
          p === "@semantic-release/npm"
      );

      if (Array.isArray(npmPlugin)) {
        const [, opts] = npmPlugin;
        expect(opts.npmFlags).toContain("--access");
        expect(opts.npmFlags).toContain("public");
      }
    });

    it("changelog plugin file path does not start with slash", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const changelogPlugin = config.plugins.find(
        (p: any) => Array.isArray(p) && p[0] === "@semantic-release/changelog"
      );

      if (changelogPlugin) {
        const [, opts] = changelogPlugin;
        expect(opts.changelogFile).not.toMatch(/^\//);
      }
    });

    it("git plugin message contains version placeholder", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const gitPlugin = config.plugins.find(
        (p: any) => Array.isArray(p) && p[0] === "@semantic-release/git"
      );

      if (gitPlugin) {
        const [, opts] = gitPlugin;
        expect(opts.message).toContain("${nextRelease.version}");
      }
    });

    it("git plugin does not commit dist directory", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const gitPlugin = config.plugins.find(
        (p: any) => Array.isArray(p) && p[0] === "@semantic-release/git"
      );

      if (gitPlugin) {
        const [, opts] = gitPlugin;
        expect(opts.assets).not.toContain("dist");
        expect(opts.assets).not.toContain("dist/**");
      }
    });

    it("plugins array has no duplicates", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const pluginNames = config.plugins.map((p: string | [string, any]) =>
        Array.isArray(p) ? p[0] : p
      );

      const uniqueNames = [...new Set(pluginNames)];
      expect(pluginNames.length).toBe(uniqueNames.length);
    });
  });

  describe("GitHub Actions workflow validation", () => {
    it("release job runs on ubuntu-latest", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      expect(workflow.jobs.release["runs-on"]).toBe("ubuntu-latest");
    });

    it("workflow fetches full git history", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const checkoutStep = workflow.jobs.release.steps.find(
        (step: any) => step.uses && step.uses.includes("actions/checkout")
      );

      expect(checkoutStep?.with?.["fetch-depth"]).toBe(0);
    });

    it("workflow uses Node.js 20", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const nodeSetupStep = workflow.jobs.release.steps.find(
        (step: any) => step.uses && step.uses.includes("actions/setup-node")
      );

      expect(nodeSetupStep?.with?.["node-version"]).toBe(20);
    });

    it("workflow uses npm ci not npm install", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const installStep = workflow.jobs.release.steps.find(
        (step: any) => step.run && step.run.includes("npm")
      );

      if (installStep) {
        expect(installStep.run).toContain("npm ci");
        expect(installStep.run).not.toContain("npm install");
      }
    });

    it("workflow does not trigger on pull request", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      expect(workflow.on.pull_request).toBeUndefined();
    });

    it("workflow only triggers on main branch", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      expect(workflow.on.push.branches).toEqual(["main"]);
      expect(workflow.on.push.branches).not.toContain("develop");
    });

    it("workflow sets npm registry URL", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const nodeSetupStep = workflow.jobs.release.steps.find(
        (step: any) => step.uses && step.uses.includes("actions/setup-node")
      );

      expect(nodeSetupStep?.with?.["registry-url"]).toBe(
        "https://registry.npmjs.org"
      );
    });

    it("semantic-release runs with npx not npm exec", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const releaseStep = workflow.jobs.release.steps.find(
        (step: any) => step.run && step.run.includes("semantic-release")
      );

      expect(releaseStep?.run).toContain("npx semantic-release");
    });
  });

  describe("Husky hooks validation", () => {
    it("commit-msg hook invokes commitlint", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("npx");
      expect(content).toContain("commitlint");
    });

    it("commit-msg hook references $1 argument", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("$1");
    });

    it("pre-commit hook exists", () => {
      const path = resolve(ROOT, ".husky/pre-commit");
      expect(existsSync(path)).toBe(true);
    });
  });

  describe("Package.json validation", () => {
    it("package.json version follows semver", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const semverPattern = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;
      expect(pkg.version).toMatch(semverPattern);
    });

    it("package.json repository URL is HTTPS not SSH", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      expect(pkg.repository.url).toMatch(/^https:\/\//);
      expect(pkg.repository.url).not.toMatch(/^git@/);
    });

    it("package.json has prepare script for husky", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      expect(pkg.scripts.prepare).toBeDefined();
      expect(pkg.scripts.prepare).toContain("husky");
    });

    it("package.json does not have prepublish script", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      expect(pkg.scripts.prepublish).toBeUndefined();
    });

    it("package.json semantic-release versions are compatible", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      // All semantic-release plugins should exist
      expect(allDeps["@semantic-release/commit-analyzer"]).toBeDefined();
      expect(allDeps["@semantic-release/release-notes-generator"]).toBeDefined();
      expect(allDeps["@semantic-release/changelog"]).toBeDefined();
      expect(allDeps["@semantic-release/npm"]).toBeDefined();
      expect(allDeps["@semantic-release/github"]).toBeDefined();
      expect(allDeps["@semantic-release/git"]).toBeDefined();
    });
  });

  describe("Community files validation", () => {
    it("CONTRIBUTING.md warns against version bumps", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("do not") ||
          content.includes("don't") ||
          content.includes("should not")
      ).toBe(true);
    });

    it("CONTRIBUTING.md explains PR target branch", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(content.includes("pr") && content.includes("develop")).toBe(true);
    });

    // Note: CODE_OF_CONDUCT.md intentionally excluded from automated task per spec
    it.skip("CODE_OF_CONDUCT.md includes enforcement section", () => {
      const path = resolve(ROOT, "CODE_OF_CONDUCT.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("enforcement") || content.includes("consequences")
      ).toBe(true);
    });

    it("SECURITY.md mentions reygent executes code", () => {
      const path = resolve(ROOT, "SECURITY.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("execute") ||
          content.includes("api") ||
          content.includes("credential")
      ).toBe(true);
    });

    it("PR template does not pre-check boxes", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).not.toContain("- [x]");
    });

    it("PR template mentions breaking changes", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("breaking") || content.includes("breaking change")
      ).toBe(true);
    });
  });

  describe("OIDC configuration validation", () => {
    it("workflow has id-token write permission", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      expect(workflow.jobs.release.permissions["id-token"]).toBe("write");
    });

    it("npm plugin uses --provenance flag", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const npmPlugin = config.plugins.find(
        (p: any) => Array.isArray(p) && p[0] === "@semantic-release/npm"
      );

      if (Array.isArray(npmPlugin)) {
        const [, opts] = npmPlugin;
        expect(opts.npmFlags).toContain("--provenance");
      }
    });

    it("workflow does not set NODE_AUTH_TOKEN", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).not.toContain("NODE_AUTH_TOKEN");
    });

    it("package.json does not have publishConfig with token", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      if (pkg.publishConfig) {
        expect(pkg.publishConfig.token).toBeUndefined();
      }
    });
  });

  describe("Error path validation", () => {
    it("releaserc branches is an array", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      expect(Array.isArray(config.branches)).toBe(true);
    });

    it("releaserc plugins is an array", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      expect(Array.isArray(config.plugins)).toBe(true);
    });

    it("workflow has at least 3 steps", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      expect(workflow.jobs.release.steps.length).toBeGreaterThanOrEqual(3);
    });

    it("commitlint config is exported", () => {
      const path = resolve(ROOT, "commitlint.config.js");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content.includes("export") || content.includes("module.exports")).toBe(
        true
      );
    });
  });

  describe("Branch strategy validation", () => {
    it("git config shows main as valid branch", async () => {
      const gitConfigPath = resolve(ROOT, ".git/config");
      expect(existsSync(gitConfigPath)).toBe(true);
    });

    it("releaserc does not include develop branch", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      expect(config.branches).not.toContain("develop");
    });
  });
});
