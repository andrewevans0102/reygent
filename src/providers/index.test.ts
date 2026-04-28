import { describe, it, expect } from "vitest";
import { getProvider, PROVIDER_NAMES } from "./index.js";
import { TaskError } from "../task.js";
import { claudeAdapter } from "./claude.js";
import { geminiAdapter } from "./gemini.js";
import { codexAdapter } from "./codex.js";
import { openrouterAdapter } from "./openrouter.js";

describe("PROVIDER_NAMES", () => {
  it("contains all 4 providers", () => {
    expect(PROVIDER_NAMES).toHaveLength(4);
    expect(PROVIDER_NAMES).toContain("claude");
    expect(PROVIDER_NAMES).toContain("gemini");
    expect(PROVIDER_NAMES).toContain("codex");
    expect(PROVIDER_NAMES).toContain("openrouter");
  });
});

describe("getProvider", () => {
  it("returns the claude adapter for 'claude'", () => {
    expect(getProvider("claude")).toBe(claudeAdapter);
  });

  it("returns the gemini adapter for 'gemini'", () => {
    expect(getProvider("gemini")).toBe(geminiAdapter);
  });

  it("returns the codex adapter for 'codex'", () => {
    expect(getProvider("codex")).toBe(codexAdapter);
  });

  it("returns the openrouter adapter for 'openrouter'", () => {
    expect(getProvider("openrouter")).toBe(openrouterAdapter);
  });

  it("throws TaskError for unknown provider name", () => {
    expect(() => getProvider("unknown-provider")).toThrow(TaskError);
  });

  it("error message includes the unknown provider name", () => {
    expect(() => getProvider("fake")).toThrow(/fake/);
  });

  it("error message includes valid provider names", () => {
    try {
      getProvider("nonexistent");
    } catch (err) {
      expect(err).toBeInstanceOf(TaskError);
      const message = (err as TaskError).message;
      for (const name of PROVIDER_NAMES) {
        expect(message).toContain(name);
      }
    }
  });

  it("each returned adapter has the expected name property", () => {
    for (const name of PROVIDER_NAMES) {
      const adapter = getProvider(name);
      expect(adapter.name).toBe(name);
    }
  });
});
