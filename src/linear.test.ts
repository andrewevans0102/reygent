import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLinearUrl, extractLinearId, readLinearSpec } from "./linear.js";

describe("isLinearUrl", () => {
  it("returns true for valid Linear URL", () => {
    expect(isLinearUrl("https://linear.app/team/issue/DT-267")).toBe(true);
  });

  it("returns true for Linear URL with extra path", () => {
    expect(isLinearUrl("https://linear.app/myteam/issue/ABC-1")).toBe(true);
  });

  it("returns false for non-Linear URL", () => {
    expect(isLinearUrl("https://github.com/owner/repo")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(isLinearUrl("DT-267")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLinearUrl("")).toBe(false);
  });
});

describe("extractLinearId", () => {
  it("extracts issue ID from URL", () => {
    expect(extractLinearId("https://linear.app/team/issue/DT-267")).toBe("DT-267");
  });

  it("extracts from URL with extra path segments", () => {
    expect(extractLinearId("https://linear.app/myteam/issue/ABC-123/some-title")).toBe("ABC-123");
  });

  it("throws for non-Linear URL", () => {
    expect(() => extractLinearId("https://github.com/foo")).toThrow(/could not extract/i);
  });
});

describe("readLinearSpec", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    };
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    vi.restoreAllMocks();
  });

  it("throws when LINEAR_API_KEY not set", async () => {
    delete process.env.LINEAR_API_KEY;
    await expect(readLinearSpec("DT-267")).rejects.toThrow(/LINEAR_API_KEY/);
  });

  it("throws for invalid issue ID format", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    await expect(readLinearSpec("invalid")).rejects.toThrow(/invalid issue identifier/i);
  });

  it("fetches and returns spec for valid issue", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";

    const mockResponse = {
      data: {
        issues: {
          nodes: [{
            id: "id-1",
            identifier: "DT-267",
            title: "Test Issue",
            description: "Description here",
            children: { nodes: [] },
          }],
        },
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await readLinearSpec("DT-267");
    expect(result.source).toBe("linear");
    expect(result.issueId).toBe("DT-267");
    expect(result.title).toBe("Test Issue");
    expect(result.content).toContain("Test Issue");
    expect(result.content).toContain("Description here");
  });

  it("includes sub-issues in content", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";

    const mockResponse = {
      data: {
        issues: {
          nodes: [{
            id: "id-1",
            identifier: "DT-267",
            title: "Parent",
            description: "Parent desc",
            children: {
              nodes: [
                { id: "c1", identifier: "DT-268", title: "Child 1", description: "Child desc" },
              ],
            },
          }],
        },
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await readLinearSpec("DT-267");
    expect(result.content).toContain("Sub-issues");
    expect(result.content).toContain("Child 1");
  });

  it("throws on API error response", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }));

    await expect(readLinearSpec("DT-267")).rejects.toThrow(/401/);
  });

  it("throws when issue not found", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { issues: { nodes: [] } } }),
    }));

    await expect(readLinearSpec("DT-999")).rejects.toThrow(/not found/i);
  });

  it("throws on GraphQL errors", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        errors: [{ message: "Bad query" }],
      }),
    }));

    await expect(readLinearSpec("DT-267")).rejects.toThrow(/Bad query/);
  });
});
