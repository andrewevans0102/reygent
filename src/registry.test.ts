import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listRemoteSkills,
  fetchSkillManifest,
  fetchSkillFiles,
  checkCompatibility,
} from "./registry.js";

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

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  } as Response;
}

function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(text),
    text: () => Promise.resolve(text),
    headers: new Headers(),
  } as Response;
}

describe("listRemoteSkills", () => {
  it("fetches and parses remote skills", async () => {
    // First call: API listing dirs
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: "code-reviewer", path: "code-reviewer", type: "dir" },
        { name: "README.md", path: "README.md", type: "file" },
      ]),
    );
    // Second call: raw SKILL.md
    mockFetch.mockResolvedValueOnce(textResponse(validSkillMd));

    const skills = await listRemoteSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("code-reviewer");
    expect(skills[0].description).toBe("Reviews code for quality");
    expect(skills[0].license).toBe("MIT");
    expect(skills[0].version).toBe("1.0.0");
  });

  it("skips skills with invalid SKILL.md", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: "bad-skill", path: "bad-skill", type: "dir" },
      ]),
    );
    mockFetch.mockResolvedValueOnce(textResponse("not valid"));

    const skills = await listRemoteSkills();
    expect(skills).toHaveLength(0);
  });

  it("throws on rate limit with GITHUB_TOKEN hint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("API rate limit exceeded"),
      headers: new Headers(),
    } as Response);

    await expect(listRemoteSkills()).rejects.toThrow(/GITHUB_TOKEN/i);
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
      headers: new Headers(),
    } as Response);

    await expect(listRemoteSkills()).rejects.toThrow(/not found/i);
  });

  it("uses GITHUB_TOKEN when set", async () => {
    process.env.GITHUB_TOKEN = "test-token-123";

    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await listRemoteSkills();

    const apiCall = mockFetch.mock.calls[0];
    expect(apiCall[1].headers.Authorization).toBe("Bearer test-token-123");
  });
});

describe("fetchSkillManifest", () => {
  it("fetches and parses manifest", async () => {
    mockFetch.mockResolvedValueOnce(textResponse(validSkillMd));

    const manifest = await fetchSkillManifest("code-reviewer");
    expect(manifest.name).toBe("code-reviewer");
    expect(manifest.description).toBe("Reviews code for quality");
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(fetchSkillManifest("code-reviewer")).rejects.toThrow(/network error/i);
  });

  it("throws on 404 skill", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

    await expect(fetchSkillManifest("nonexistent")).rejects.toThrow(/failed to fetch/i);
  });
});

describe("fetchSkillFiles", () => {
  it("fetches all files recursively", async () => {
    // API call: list skill dir
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: "SKILL.md", path: "my-skill/SKILL.md", type: "file" },
        { name: "references", path: "my-skill/references", type: "dir" },
      ]),
    );
    // Raw: SKILL.md content
    mockFetch.mockResolvedValueOnce(textResponse("# Skill content"));
    // API call: list references subdir
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: "guide.md", path: "my-skill/references/guide.md", type: "file" },
      ]),
    );
    // Raw: guide.md content
    mockFetch.mockResolvedValueOnce(textResponse("# Guide"));

    const files = await fetchSkillFiles("my-skill");

    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("SKILL.md");
    expect(files[0].content).toBe("# Skill content");
    expect(files[1].path).toBe("references/guide.md");
    expect(files[1].content).toBe("# Guide");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
      headers: new Headers(),
    } as Response);

    await expect(fetchSkillFiles("nonexistent")).rejects.toThrow(/not found/i);
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
