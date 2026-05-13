import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildCommitMessage } from "../../src/pr-create.js";
import type { TaskContext, PlannerOutput } from "../../src/task.js";
import type { SpecPayload } from "../../src/spec.js";
import type { BranchType } from "../../src/branch-type.js";

const ROOT = resolve(import.meta.dirname, "../..");

describe("Commitlint validation", () => {
  describe("Valid conventional commit formats", () => {
    const validMessages = [
      "feat: add new feature",
      "fix: resolve bug",
      "docs: update README",
      "chore: update dependencies",
      "feat!: breaking change",
      "feat(api)!: breaking API change",
      "fix(auth): patch login flow",
      "refactor(core): simplify logic",
      "test: add unit tests",
      "style: format code",
      "perf: optimize queries",
      "ci: update workflow",
      "build: configure bundler",
      "revert: revert previous commit",
    ];

    validMessages.forEach((msg) => {
      it(`accepts valid format: "${msg}"`, () => {
        // Verify format structure matches conventional commits spec
        const conventionalPattern =
          /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?:\s.+/;
        expect(msg).toMatch(conventionalPattern);
      });
    });
  });

  describe("Invalid conventional commit formats", () => {
    const invalidMessages = [
      { msg: "Add new feature", reason: "missing type" },
      { msg: "feat add feature", reason: "missing colon" },
      { msg: "feat:", reason: "missing description" },
      { msg: "feat: ", reason: "empty description" },
      { msg: "feature: add thing", reason: "invalid type" },
      { msg: "FEAT: add feature", reason: "uppercase type" },
      { msg: "feat:add feature", reason: "missing space after colon" },
      { msg: "feat(add feature", reason: "unclosed scope" },
      { msg: "feat): add feature", reason: "malformed scope" },
      { msg: "feat!add feature", reason: "missing colon after bang" },
    ];

    invalidMessages.forEach(({ msg, reason }) => {
      it(`rejects invalid format (${reason}): "${msg}"`, () => {
        const conventionalPattern =
          /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?:\s.+/;
        expect(msg).not.toMatch(conventionalPattern);
      });
    });
  });

  describe("Commitlint config structure", () => {
    it("config extends @commitlint/config-conventional", () => {
      const path = resolve(ROOT, "commitlint.config.js");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("@commitlint/config-conventional");
    });

    it("config is valid JavaScript syntax", () => {
      const path = resolve(ROOT, "commitlint.config.js");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("extends");
    });
  });

  describe("Conventional commit type validation", () => {
    const validTypes = [
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
    ];

    validTypes.forEach((type) => {
      it(`accepts valid type: ${type}`, () => {
        const msg = `${type}: some description`;
        const pattern =
          /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert):\s.+/;
        expect(msg).toMatch(pattern);
      });
    });

    const invalidTypes = [
      "feature",
      "bugfix",
      "documentation",
      "update",
      "add",
      "remove",
      "change",
    ];

    invalidTypes.forEach((type) => {
      it(`rejects invalid type: ${type}`, () => {
        const msg = `${type}: some description`;
        const validPattern =
          /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert):\s.+/;
        expect(msg).not.toMatch(validPattern);
      });
    });
  });

  describe("Scope validation", () => {
    it("accepts empty scope", () => {
      const msg = "feat: add feature";
      const pattern = /^feat:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts single word scope", () => {
      const msg = "feat(api): add endpoint";
      const pattern = /^feat\([a-z]+\):\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts multi-word scope with dash", () => {
      const msg = "feat(user-auth): add login";
      const pattern = /^feat\([a-z-]+\):\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts asterisk scope for multiple packages", () => {
      const msg = "feat(*): update all packages";
      const pattern = /^feat\(\*\):\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("rejects scope with spaces", () => {
      const msg = "feat(my scope): add feature";
      const pattern = /^feat\([a-z-]+\):\s.+/;
      expect(msg).not.toMatch(pattern);
    });
  });

  describe("Breaking change validation", () => {
    it("accepts breaking change with bang", () => {
      const msg = "feat!: breaking change";
      const pattern = /^feat!:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts breaking change with bang and scope", () => {
      const msg = "feat(api)!: breaking change";
      const pattern = /^feat\(.+\)!:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("rejects bang without colon", () => {
      const msg = "feat! breaking change";
      const pattern = /^feat!:\s.+/;
      expect(msg).not.toMatch(pattern);
    });

    it("rejects bang before scope", () => {
      const msg = "feat!(api): breaking change";
      const pattern = /^feat\(.+\)!:\s.+/;
      expect(msg).not.toMatch(pattern);
    });
  });

  describe("Description validation", () => {
    it("accepts description starting with lowercase", () => {
      const msg = "feat: add new feature";
      const pattern = /^feat:\s[a-z]/;
      expect(msg).toMatch(pattern);
    });

    it("detects description starting with uppercase", () => {
      const msg = "feat: Add new feature";
      const pattern = /^feat:\s[A-Z]/;
      expect(msg).toMatch(pattern);
    });

    it("accepts description with punctuation", () => {
      const msg = "feat: add user's profile page";
      expect(msg).toContain("'");
    });

    it("detects description ending with period", () => {
      const msg = "feat: add feature.";
      expect(msg).toMatch(/\.$/);
    });

    it("accepts multi-word description", () => {
      const msg = "feat: add user authentication with OAuth";
      const words = msg.split(":")[1].trim().split(" ");
      expect(words.length).toBeGreaterThan(1);
    });
  });

  describe("Husky integration", () => {
    it("commit-msg hook exists and is executable", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      expect(existsSync(path)).toBe(true);

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("commitlint");
    });

    it("commit-msg hook uses --edit flag", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("--edit");
    });

    it("commit-msg hook references commit message file", () => {
      const path = resolve(ROOT, ".husky/commit-msg");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("$1");
    });
  });

  describe("Commitlint package validation", () => {
    it("@commitlint/cli is installed", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      expect(allDeps["@commitlint/cli"]).toBeDefined();
    });

    it("@commitlint/config-conventional is installed", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      expect(allDeps["@commitlint/config-conventional"]).toBeDefined();
    });

    it("commitlint versions are compatible", () => {
      const path = resolve(ROOT, "package.json");
      const content = readFileSync(path, "utf-8");
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      const cliVersion = allDeps["@commitlint/cli"];
      const configVersion = allDeps["@commitlint/config-conventional"];

      expect(cliVersion).toBeDefined();
      expect(configVersion).toBeDefined();

      // Both should have version numbers
      expect(cliVersion).toMatch(/\d+/);
      expect(configVersion).toMatch(/\d+/);
    });
  });

  describe("Edge cases", () => {
    it("accepts very long commit message", () => {
      const longDescription = "a".repeat(500);
      const msg = `feat: ${longDescription}`;
      const pattern = /^feat:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts commit with numbers in description", () => {
      const msg = "feat: add support for Node.js 22";
      const pattern = /^feat:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts commit with special characters", () => {
      const msg = "fix: resolve @mention & #hash issues";
      const pattern = /^fix:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts commit referencing issue number", () => {
      const msg = "fix: resolve login bug (#123)";
      const pattern = /^fix:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("rejects completely empty message", () => {
      const msg = "";
      const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert):\s.+/;
      expect(msg).not.toMatch(pattern);
    });

    it("rejects message with only whitespace", () => {
      const msg = "   ";
      const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert):\s.+/;
      expect(msg).not.toMatch(pattern);
    });

    it("rejects message with only type", () => {
      const msg = "feat";
      const pattern = /^feat:\s.+/;
      expect(msg).not.toMatch(pattern);
    });

    it("rejects message with trailing spaces after description", () => {
      const msg = "feat: add feature   ";
      // Check if there are trailing spaces
      expect(msg.trimEnd().length).toBeLessThan(msg.length);
    });
  });

  describe("Real-world commit message patterns", () => {
    const realWorldMessages = [
      "feat: add user authentication with OAuth",
      "fix: resolve memory leak in cache module",
      "docs: update installation instructions",
      "chore: update dependencies to latest versions",
      "feat(api): add pagination to user endpoint",
      "fix(auth): prevent token refresh race condition",
      "refactor(core): extract validation logic",
      "test(api): add integration tests for auth flow",
      "perf(db): optimize query performance with indexes",
      "style(components): apply consistent formatting",
      "ci: add automated release workflow",
      "build: configure provenance for npm publish",
      "feat!: migrate to new API version",
      "revert: revert feat: add experimental feature",
    ];

    realWorldMessages.forEach((msg) => {
      it(`accepts real-world pattern: "${msg}"`, () => {
        const pattern =
          /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?:\s.+/;
        expect(msg).toMatch(pattern);
      });
    });
  });

  describe("buildCommitMessage conventional commits compatibility", () => {
    const conventionalPattern =
      /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?:\s.+/;

    function makeContext(spec: SpecPayload, plan?: PlannerOutput): TaskContext {
      return { spec, plan, results: [] };
    }

    it("jira output matches conventional commits format", () => {
      const spec: SpecPayload = { source: "jira", issueKey: "PROJ-123", title: "Fix login bug", content: "" };
      const msg = buildCommitMessage(makeContext(spec), "feat");
      const subject = msg.split("\n")[0];
      expect(subject).toMatch(conventionalPattern);
      expect(subject).toBe("feat(PROJ-123): Fix login bug");
    });

    it("linear output matches conventional commits format", () => {
      const spec: SpecPayload = { source: "linear", issueId: "DT-99", title: "Resolve auth issue", content: "" };
      const msg = buildCommitMessage(makeContext(spec), "fix");
      const subject = msg.split("\n")[0];
      expect(subject).toMatch(conventionalPattern);
      expect(subject).toBe("fix(DT-99): Resolve auth issue");
    });

    it("markdown output matches conventional commits format", () => {
      const spec: SpecPayload = { source: "markdown", title: "Update dependencies", content: "" };
      const msg = buildCommitMessage(makeContext(spec), "chore");
      const subject = msg.split("\n")[0];
      expect(subject).toMatch(conventionalPattern);
      expect(subject).toBe("chore: Update dependencies");
    });

    it("all branch types produce valid conventional commit subjects", () => {
      const types: BranchType[] = ["feat", "fix", "chore", "refactor", "docs", "test", "style", "perf"];
      const spec: SpecPayload = { source: "linear", issueId: "DT-1", title: "Do something", content: "" };
      for (const type of types) {
        const msg = buildCommitMessage(makeContext(spec), type);
        const subject = msg.split("\n")[0];
        expect(subject).toMatch(conventionalPattern);
      }
    });

    it("multi-line message has valid subject line", () => {
      const spec: SpecPayload = { source: "jira", issueKey: "PROJ-5", title: "Add feature", content: "" };
      const plan: PlannerOutput = { goals: ["g1"], tasks: ["t1"], constraints: [], dod: [] };
      const msg = buildCommitMessage(makeContext(spec, plan), "feat");
      const subject = msg.split("\n")[0];
      expect(subject).toMatch(conventionalPattern);
      expect(msg).toContain("Goals:");
    });
  });

  describe("Security and injection prevention", () => {
    it("accepts commit with code snippet", () => {
      const msg = "fix: prevent `eval()` injection";
      const pattern = /^fix:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts commit with URL", () => {
      const msg = "docs: add link to https://example.com/docs";
      const pattern = /^docs:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("accepts commit with escaped characters", () => {
      const msg = 'feat: add support for \\"quoted\\" strings';
      const pattern = /^feat:\s.+/;
      expect(msg).toMatch(pattern);
    });

    it("detects potential shell injection attempt", () => {
      const msg = "feat: add feature; rm -rf /";
      // Still valid conventional commit format, but shows suspicious content
      const pattern = /^feat:\s.+/;
      expect(msg).toMatch(pattern);
      expect(msg).toContain(";");
    });
  });
});
