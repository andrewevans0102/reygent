import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listRemoteSkills,
  fetchSkillManifest,
  fetchSkillFiles,
  checkCompatibility,
} from "./registry.js";

// --- Mocks ---

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("./config.js", () => ({
  resolveGlobalConfigDir: vi.fn(() => "/mock/home/.reygent"),
}));

// Don't mock skills.js — use real parseSkillMd
// vi.mock("./skills.js") is intentionally NOT here

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);
const mockMkdirSync = vi.mocked(mkdirSync);

const CACHE_DIR = "/mock/home/.reygent/cache/registry";
const GIT_DIR = `${CACHE_DIR}/.git`;
const FETCH_HEAD = `${GIT_DIR}/FETCH_HEAD`;

const validSkillMd = `---
name: code-reviewer
description: Reviews code for quality
license: MIT
compatibility: ">=0.1.0"
metadata:
  version: "1.0.0"
---

# Code Reviewer

You review code.`;

/**
 * Set up mocks so ensureCache() sees a fresh, existing cache.
 */
function setupFreshCache(): void {
  // .git dir exists
  mockExistsSync.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path === GIT_DIR) return true;
    if (path === FETCH_HEAD) return true;
    return false;
  });
  // FETCH_HEAD is recent (not stale)
  mockStatSync.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path === FETCH_HEAD) {
      return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
    }
    return { isDirectory: () => false } as ReturnType<typeof statSync>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("listRemoteSkills", () => {
  it("reads skill dirs from cache and parses SKILL.md", async () => {
    // ensureCache: fresh cache exists
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      if (path === `${CACHE_DIR}/code-reviewer/SKILL.md`) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
      }
      if (path === `${CACHE_DIR}/code-reviewer`) {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });
    mockReaddirSync.mockReturnValue(["code-reviewer", "README.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(validSkillMd);

    const skills = await listRemoteSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("code-reviewer");
    expect(skills[0].description).toBe("Reviews code for quality");
    expect(skills[0].license).toBe("MIT");
    expect(skills[0].version).toBe("1.0.0");
  });

  it("skips .git and dot-prefixed entries", async () => {
    setupFreshCache();
    mockReaddirSync.mockReturnValue([".git", ".hidden", "README.md"] as unknown as ReturnType<typeof readdirSync>);

    const skills = await listRemoteSkills();
    expect(skills).toHaveLength(0);
  });

  it("skips skills with invalid SKILL.md", async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      if (path === `${CACHE_DIR}/bad-skill/SKILL.md`) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
      }
      if (path === `${CACHE_DIR}/bad-skill`) {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });
    mockReaddirSync.mockReturnValue(["bad-skill"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue("not valid yaml frontmatter");

    const skills = await listRemoteSkills();
    expect(skills).toHaveLength(0);
  });
});

describe("fetchSkillManifest", () => {
  it("reads and parses SKILL.md from cache", async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      if (path === `${CACHE_DIR}/code-reviewer/SKILL.md`) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });
    mockReadFileSync.mockReturnValue(validSkillMd);

    const manifest = await fetchSkillManifest("code-reviewer");
    expect(manifest.name).toBe("code-reviewer");
    expect(manifest.description).toBe("Reviews code for quality");
  });

  it("throws on missing skill", async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });

    await expect(fetchSkillManifest("nonexistent")).rejects.toThrow(/skill not found/i);
  });
});

describe("fetchSkillFiles", () => {
  it("recursively reads all files with relative paths", async () => {
    const skillDir = `${CACHE_DIR}/my-skill`;

    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      if (path === skillDir) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
      }
      if (path === skillDir || path === `${skillDir}/references`) {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });
    mockReaddirSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === skillDir) return ["SKILL.md", "references"] as unknown as ReturnType<typeof readdirSync>;
      if (path === `${skillDir}/references`) return ["guide.md"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === `${skillDir}/SKILL.md`) return "# Skill content";
      if (path === `${skillDir}/references/guide.md`) return "# Guide";
      return "";
    });

    const files = await fetchSkillFiles("my-skill");

    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("SKILL.md");
    expect(files[0].content).toBe("# Skill content");
    expect(files[1].path).toBe("references/guide.md");
    expect(files[1].content).toBe("# Guide");
  });

  it("throws on missing skill", async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });

    await expect(fetchSkillFiles("nonexistent")).rejects.toThrow(/skill not found/i);
  });
});

describe("ensureCache (via public functions)", () => {
  it("clones on first use when no cache exists", async () => {
    // No .git dir → triggers clone
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return false;
      return false;
    });
    mockExecFileSync.mockReturnValue("");
    // After clone, listRemoteSkills reads dirs
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    await listRemoteSkills();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("cache"),
      { recursive: true },
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", expect.stringContaining("reygent-skills.git"), CACHE_DIR],
      expect.any(Object),
    );
  });

  it("pulls when cache is stale", async () => {
    // .git exists, FETCH_HEAD exists but old
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return true;
      if (path === FETCH_HEAD) return true;
      return false;
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === FETCH_HEAD) {
        return { mtimeMs: Date.now() - 10 * 60 * 1000 } as ReturnType<typeof statSync>; // 10 min ago
      }
      return { isDirectory: () => false } as ReturnType<typeof statSync>;
    });
    mockExecFileSync.mockReturnValue("");
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    await listRemoteSkills();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["pull", "--ff-only"],
      expect.objectContaining({ cwd: CACHE_DIR }),
    );
  });

  it("always pulls when cache exists", async () => {
    setupFreshCache();
    mockExecFileSync.mockReturnValue("");
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    await listRemoteSkills();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["pull", "--ff-only"],
      expect.objectContaining({ cwd: CACHE_DIR }),
    );
  });

  it("throws clear error when git is not installed", async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === GIT_DIR) return false;
      return false;
    });
    const enoent = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    mockExecFileSync.mockImplementation(() => {
      throw enoent;
    });

    await expect(listRemoteSkills()).rejects.toThrow(/git is not installed/i);
  });
});

describe("checkCompatibility", () => {
  it("returns true when compatibility undefined", () => {
    expect(checkCompatibility(undefined, "0.1.0")).toBe(true);
  });

  it("returns true when version meets requirement", () => {
    expect(checkCompatibility(">=0.1.0", "0.1.0")).toBe(true);
    expect(checkCompatibility(">=0.1.0", "0.2.0")).toBe(true);
    expect(checkCompatibility(">=0.1.0", "1.0.0")).toBe(true);
  });

  it("returns false when version too low", () => {
    expect(checkCompatibility(">=0.2.0", "0.1.0")).toBe(false);
    expect(checkCompatibility(">=1.0.0", "0.9.9")).toBe(false);
  });

  it("returns true on unknown format", () => {
    expect(checkCompatibility("~1.0", "0.1.0")).toBe(true);
  });

  it("handles patch version comparison", () => {
    expect(checkCompatibility(">=0.1.5", "0.1.4")).toBe(false);
    expect(checkCompatibility(">=0.1.5", "0.1.5")).toBe(true);
    expect(checkCompatibility(">=0.1.5", "0.1.6")).toBe(true);
  });
});
