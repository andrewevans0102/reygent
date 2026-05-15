import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");

describe("Release setup integration", () => {
  describe("Commitlint configuration", () => {
    it("commitlint.config.js exists at project root", () => {
      const path = resolve(ROOT, "commitlint.config.js");
      expect(existsSync(path), "commitlint.config.js not found").toBe(true);
    });

    it("commitlint config extends conventional", () => {
      const path = resolve(ROOT, "commitlint.config.js");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("@commitlint/config-conventional");
    });
  });

  describe("Husky hooks", () => {
    it(".husky directory exists", () => {
      const path = resolve(ROOT, ".husky");
      expect(existsSync(path), ".husky directory not found").toBe(true);
    });

    it("commit-msg hook exists", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      expect(existsSync(path), "commit-msg hook not found").toBe(true);
    });

    it("commit-msg hook runs commitlint", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("commitlint");
      expect(content).toContain("--edit");
    });
  });

  describe("semantic-release configuration", () => {
    it(".releaserc.json exists", () => {
      const path = resolve(ROOT, ".releaserc.json");
      expect(existsSync(path), ".releaserc.json not found").toBe(true);
    });

    it(".releaserc.json has correct structure", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      expect(config.branches).toContain("main");
      expect(Array.isArray(config.plugins)).toBe(true);
    });

    it(".releaserc.json includes all required plugins", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const pluginNames = config.plugins.map((p: string | [string, any]) =>
        Array.isArray(p) ? p[0] : p
      );

      const required = [
        "@semantic-release/commit-analyzer",
        "@semantic-release/release-notes-generator",
        "@semantic-release/changelog",
        "@semantic-release/npm",
        "@semantic-release/github",
        "@semantic-release/git",
      ];

      for (const name of required) {
        expect(pluginNames).toContain(name);
      }
    });

    it(".releaserc.json npm plugin has provenance enabled", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const npmPlugin = config.plugins.find(
        (p: any) =>
          (Array.isArray(p) && p[0] === "@semantic-release/npm") ||
          p === "@semantic-release/npm"
      );

      expect(npmPlugin).toBeDefined();

      if (Array.isArray(npmPlugin)) {
        const [, opts] = npmPlugin;
        expect(opts.npmPublish).toBe(true);
        expect(opts.npmFlags).toContain("--provenance");
        expect(opts.npmFlags).toContain("--access");
      }
    });

    it(".releaserc.json changelog plugin configured", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const changelogPlugin = config.plugins.find(
        (p: any) => Array.isArray(p) && p[0] === "@semantic-release/changelog"
      );

      expect(changelogPlugin).toBeDefined();

      if (changelogPlugin) {
        const [, opts] = changelogPlugin;
        expect(opts.changelogFile).toBe("CHANGELOG.md");
      }
    });

    it(".releaserc.json git plugin commits package.json and CHANGELOG.md", () => {
      const path = resolve(ROOT, ".releaserc.json");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const config = JSON.parse(content);

      const gitPlugin = config.plugins.find(
        (p: any) => Array.isArray(p) && p[0] === "@semantic-release/git"
      );

      expect(gitPlugin).toBeDefined();

      if (gitPlugin) {
        const [, opts] = gitPlugin;
        expect(opts.assets).toContain("package.json");
        expect(opts.assets).toContain("CHANGELOG.md");
        expect(opts.message).toContain("[skip ci]");
      }
    });
  });

  describe("GitHub Actions workflow", () => {
    it(".github/workflows/release.yml exists", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      expect(existsSync(path), "release.yml not found").toBe(true);
    });

    it("release.yml triggers on main branch push", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      expect(workflow.on.push.branches).toContain("main");
    });

    it("release.yml has required permissions", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const perms = workflow.jobs.release.permissions;
      expect(perms.contents).toBe("write");
      expect(perms.issues).toBe("write");
      expect(perms["pull-requests"]).toBe("write");
      expect(perms["id-token"]).toBe("write");
    });

    it("release.yml runs semantic-release", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const steps = workflow.jobs.release.steps;
      const hasSemanticRelease = steps.some(
        (step: any) =>
          step.run && step.run.includes("semantic-release")
      );

      expect(hasSemanticRelease).toBe(true);
    });

    it("release.yml does not use NPM_TOKEN secret", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).not.toContain("NPM_TOKEN");
    });

    it("release.yml uses GITHUB_TOKEN", () => {
      const path = resolve(ROOT, ".github/workflows/release.yml");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const workflow = parseYaml(content);

      const steps = workflow.jobs.release.steps;
      const semanticReleaseStep = steps.find(
        (step: any) => step.run && step.run.includes("semantic-release")
      );

      expect(semanticReleaseStep?.env?.GITHUB_TOKEN).toBeDefined();
    });
  });

  describe("Package configuration", () => {
    it("package.json name is reygent-code", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      expect(pkg.name).toBe("reygent-code");
    });

    it("package.json has repository field", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      expect(pkg.repository).toBeDefined();
      expect(pkg.repository.type).toBe("git");
      expect(pkg.repository.url).toContain("github.com");
    });

    it("package.json has semantic-release dependencies", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      expect(allDeps["semantic-release"]).toBeDefined();
      expect(allDeps["@semantic-release/changelog"]).toBeDefined();
      expect(allDeps["@semantic-release/git"]).toBeDefined();
    });

    it("package.json has commitlint dependencies", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      expect(allDeps["@commitlint/cli"]).toBeDefined();
      expect(allDeps["@commitlint/config-conventional"]).toBeDefined();
    });

    it("package.json has husky dependency", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      expect(allDeps["husky"]).toBeDefined();
    });
  });
});
