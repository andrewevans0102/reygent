import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  parseSkillMd,
  validateSkillName,
  skillToAgentConfig,
  mapToolNames,
  discoverSkills,
  loadSkillFromDirectory,
} from "./skills.js";
import type { SkillManifest } from "./skills.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

const validSkillMd = `---
name: code-reviewer
description: Reviews code for quality
license: MIT
metadata:
  role: skill
  author: test
allowed-tools:
  - read
  - bash
---

# Code Reviewer

You review code.`;

describe("validateSkillName", () => {
  it("accepts valid names", () => {
    expect(validateSkillName("code-reviewer")).toBe(true);
    expect(validateSkillName("a")).toBe(true);
    expect(validateSkillName("test-gen-2")).toBe(true);
    expect(validateSkillName("abc")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateSkillName("")).toBe(false);
  });

  it("rejects names over 64 chars", () => {
    expect(validateSkillName("a".repeat(65))).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(validateSkillName("Code-Reviewer")).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    expect(validateSkillName("code--reviewer")).toBe(false);
  });

  it("rejects leading hyphen", () => {
    expect(validateSkillName("-code")).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    expect(validateSkillName("code-")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(validateSkillName("code reviewer")).toBe(false);
  });
});

describe("parseSkillMd", () => {
  it("parses valid SKILL.md", () => {
    const result = parseSkillMd(validSkillMd, "/skills/code-reviewer");
    expect(result.name).toBe("code-reviewer");
    expect(result.description).toBe("Reviews code for quality");
    expect(result.license).toBe("MIT");
    expect(result.allowedTools).toEqual(["read", "bash"]);
    expect(result.metadata).toEqual({ role: "skill", author: "test" });
    expect(result.body).toContain("# Code Reviewer");
    expect(result.skillPath).toBe("/skills/code-reviewer");
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseSkillMd("no frontmatter", "/x")).toThrow(/must start with/i);
  });

  it("throws on unclosed frontmatter", () => {
    expect(() => parseSkillMd("---\nname: x\n", "/x")).toThrow(/missing closing/i);
  });

  it("throws on missing name", () => {
    const md = `---\ndescription: test\n---\nbody`;
    expect(() => parseSkillMd(md, "/x")).toThrow(/requires 'name'/i);
  });

  it("throws on missing description", () => {
    const md = `---\nname: test\n---\nbody`;
    expect(() => parseSkillMd(md, "/x")).toThrow(/requires 'description'/i);
  });

  it("throws on invalid skill name in frontmatter", () => {
    const md = `---\nname: Bad-Name\ndescription: test\n---\nbody`;
    expect(() => parseSkillMd(md, "/x")).toThrow(/invalid skill name/i);
  });

  it("throws on invalid YAML", () => {
    const md = `---\n: : :\n---\nbody`;
    expect(() => parseSkillMd(md, "/x")).toThrow(/invalid yaml/i);
  });

  it("handles missing optional fields", () => {
    const md = `---\nname: minimal\ndescription: bare minimum\n---\nbody`;
    const result = parseSkillMd(md, "/x");
    expect(result.license).toBeUndefined();
    expect(result.allowedTools).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});

describe("mapToolNames", () => {
  it("lowercases tool names", () => {
    expect(mapToolNames(["Read", "BASH"])).toEqual(["read", "bash"]);
  });

  it("strips qualifiers", () => {
    expect(mapToolNames(["Bash(git:*)"])).toEqual(["bash"]);
  });

  it("deduplicates", () => {
    expect(mapToolNames(["read", "Read", "READ"])).toEqual(["read"]);
  });

  it("handles empty array", () => {
    expect(mapToolNames([])).toEqual([]);
  });

  it("strips qualifiers and deduplicates together", () => {
    expect(mapToolNames(["Bash(git:*)", "bash"])).toEqual(["bash"]);
  });
});

describe("skillToAgentConfig", () => {
  const baseSkill: SkillManifest = {
    name: "test-skill",
    description: "A test skill",
    body: "# Instructions\nDo stuff.",
    skillPath: "/skills/test-skill",
    allowedTools: ["Read", "Bash(git:*)"],
    metadata: { role: "reviewer", author: "test" },
  };

  it("maps to AgentConfig correctly", () => {
    const config = skillToAgentConfig(baseSkill);
    expect(config.name).toBe("test-skill");
    expect(config.description).toBe("A test skill");
    expect(config.systemPrompt).toBe("# Instructions\nDo stuff.");
    expect(config.tools).toEqual(["read", "bash"]);
    expect(config.role).toBe("reviewer");
  });

  it("defaults role to 'skill' when no metadata.role", () => {
    const skill = { ...baseSkill, metadata: undefined };
    expect(skillToAgentConfig(skill).role).toBe("skill");
  });

  it("defaults tools to ['read'] when no allowedTools", () => {
    const skill = { ...baseSkill, allowedTools: undefined };
    expect(skillToAgentConfig(skill).tools).toEqual(["read"]);
  });
});

describe("loadSkillFromDirectory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads valid skill", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(validSkillMd);

    const result = loadSkillFromDirectory("/skills/code-reviewer");
    expect(result.name).toBe("code-reviewer");
  });

  it("throws when SKILL.md missing", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => loadSkillFromDirectory("/skills/nope")).toThrow(/no skill\.md/i);
  });

  it("throws when name doesn't match directory", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(validSkillMd);
    expect(() => loadSkillFromDirectory("/skills/wrong-name")).toThrow(/does not match/i);
  });
});

describe("discoverSkills", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array when path doesn't exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(discoverSkills("/nonexistent")).toEqual([]);
  });

  it("discovers valid skills", () => {
    // existsSync: first for skillsPath dir, then for SKILL.md in subdir, then for loadSkill
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["code-reviewer"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue(validSkillMd);

    const results = discoverSkills("/skills");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("code-reviewer");
  });

  it("skips non-directory entries", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["file.txt"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => false } as ReturnType<typeof statSync>);

    expect(discoverSkills("/skills")).toEqual([]);
  });

  it("skips directories without SKILL.md", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("SKILL.md")) return false;
      return true;
    });
    mockReaddirSync.mockReturnValue(["empty-dir"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

    expect(discoverSkills("/skills")).toEqual([]);
  });

  it("skips invalid skills silently", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["bad-skill"] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("not valid frontmatter");

    expect(discoverSkills("/skills")).toEqual([]);
  });
});
