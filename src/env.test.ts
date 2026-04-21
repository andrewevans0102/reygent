import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "./env.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("loadEnvFile", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...process.env };
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("does nothing when .env not found", () => {
    mockExistsSync.mockReturnValue(false);
    loadEnvFile();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("loads key=value pairs", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("FOO=bar\nBAZ=qux");
    delete process.env.FOO;
    delete process.env.BAZ;

    loadEnvFile();

    expect(process.env.FOO).toBe("bar");
    expect(process.env.BAZ).toBe("qux");
  });

  it("skips comments and blank lines", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# comment\n\nKEY1=val1");
    delete process.env.KEY1;

    loadEnvFile();

    expect(process.env.KEY1).toBe("val1");
  });

  it("does not overwrite existing env vars", () => {
    process.env.EXISTING = "original";
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("EXISTING=overwritten");

    loadEnvFile();

    expect(process.env.EXISTING).toBe("original");
  });

  it("strips quotes from values", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('QUOTED="hello world"');
    delete process.env.QUOTED;

    loadEnvFile();

    expect(process.env.QUOTED).toBe("hello world");
  });

  it("strips single quotes from values", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("SINGLE='hello'");
    delete process.env.SINGLE;

    loadEnvFile();

    expect(process.env.SINGLE).toBe("hello");
  });

  it("skips lines without =", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("NOEQ\nGOOD=val");
    delete process.env.GOOD;

    loadEnvFile();

    expect(process.env.GOOD).toBe("val");
  });

  it("handles value with = in it", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("COMPLEX=a=b=c");
    delete process.env.COMPLEX;

    loadEnvFile();

    expect(process.env.COMPLEX).toBe("a=b=c");
  });
});
