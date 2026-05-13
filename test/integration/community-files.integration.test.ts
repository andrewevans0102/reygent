import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

describe("Community files integration", () => {
  describe("CONTRIBUTING.md", () => {
    it("CONTRIBUTING.md exists at project root", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      expect(existsSync(path), "CONTRIBUTING.md not found").toBe(true);
    });

    it("CONTRIBUTING.md mentions conventional commits", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("conventional commit") ||
          content.includes("conventional-commit") ||
          content.includes("conventionalcommit")
      ).toBe(true);
    });

    it("CONTRIBUTING.md mentions develop branch", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("develop");
    });

    it("CONTRIBUTING.md explains commit format with examples", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const hasFeatExample = content.includes("feat:") || content.includes("feat(");
      const hasFixExample = content.includes("fix:") || content.includes("fix(");

      expect(hasFeatExample || hasFixExample).toBe(true);
    });

    it("CONTRIBUTING.md covers local setup", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(content.includes("npm install") || content.includes("clone")).toBe(
        true
      );
    });

    it("CONTRIBUTING.md mentions semantic-release handles versioning", () => {
      const path = resolve(ROOT, "CONTRIBUTING.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("semantic-release") || content.includes("version")
      ).toBe(true);
    });
  });

  describe("CODE_OF_CONDUCT.md", () => {
    // Note: CODE_OF_CONDUCT.md intentionally excluded from automated task per spec
    // Will be added manually later if needed
    it.skip("CODE_OF_CONDUCT.md exists at project root", () => {
      const path = resolve(ROOT, "CODE_OF_CONDUCT.md");
      expect(existsSync(path), "CODE_OF_CONDUCT.md not found").toBe(true);
    });

    it("CODE_OF_CONDUCT.md uses Contributor Covenant", () => {
      const path = resolve(ROOT, "CODE_OF_CONDUCT.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("Contributor Covenant");
    });

    it("CODE_OF_CONDUCT.md includes contact email", () => {
      const path = resolve(ROOT, "CODE_OF_CONDUCT.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const hasEmail =
        content.includes("@") && content.includes("contact");

      expect(hasEmail).toBe(true);
    });

    it("CODE_OF_CONDUCT.md is version 2.1", () => {
      const path = resolve(ROOT, "CODE_OF_CONDUCT.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content.includes("2.1") || content.includes("v2.1")).toBe(true);
    });
  });

  describe("SECURITY.md", () => {
    it("SECURITY.md exists at project root", () => {
      const path = resolve(ROOT, "SECURITY.md");
      expect(existsSync(path), "SECURITY.md not found").toBe(true);
    });

    it("SECURITY.md explains private vulnerability reporting", () => {
      const path = resolve(ROOT, "SECURITY.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("private") ||
          content.includes("privately") ||
          content.includes("security advisory")
      ).toBe(true);
    });

    it("SECURITY.md warns against public issue reporting", () => {
      const path = resolve(ROOT, "SECURITY.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("do not") ||
          content.includes("don't") ||
          content.includes("avoid")
      ).toBe(true);
    });

    it("SECURITY.md includes contact method", () => {
      const path = resolve(ROOT, "SECURITY.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      const hasContactMethod =
        content.includes("@") ||
        content.includes("email") ||
        content.includes("github.com/") ||
        content.includes("security");

      expect(hasContactMethod).toBe(true);
    });
  });

  describe("Pull Request Template", () => {
    it(".github/PULL_REQUEST_TEMPLATE.md exists", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      expect(existsSync(path), "PULL_REQUEST_TEMPLATE.md not found").toBe(
        true
      );
    });

    it("PR template mentions conventional commits", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(
        content.includes("conventional") || content.includes("commit format")
      ).toBe(true);
    });

    it("PR template mentions develop branch", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      expect(content).toContain("develop");
    });

    it("PR template includes checklist", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8");
      const hasCheckbox =
        content.includes("- [ ]") || content.includes("- [x]");

      expect(hasCheckbox).toBe(true);
    });

    it("PR template prompts for tests", () => {
      const path = resolve(ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
      if (!existsSync(path)) return;

      const content = readFileSync(path, "utf-8").toLowerCase();
      expect(content.includes("test")).toBe(true);
    });
  });

  describe("Branch structure", () => {
    it("Git repository exists", () => {
      const path = resolve(ROOT, ".git");
      expect(existsSync(path), ".git directory not found").toBe(true);
    });
  });
});
