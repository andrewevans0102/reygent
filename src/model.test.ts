import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("./config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

const {
  resolveAlias,
  validateModel,
  setModelOverride,
  getModel,
  SUPPORTED_MODELS,
  DEFAULT_MODEL,
} = await import("./model.js");

const { TaskError } = await import("./task.js");

describe("resolveAlias", () => {
  it("resolves claude-sonnet-4-5 to full ID", () => {
    expect(resolveAlias("claude-sonnet-4-5")).toBe("claude-sonnet-4-5-20250929");
  });

  it("resolves claude-haiku-4-5 to full ID", () => {
    expect(resolveAlias("claude-haiku-4-5")).toBe("claude-haiku-4-5-20251001");
  });

  it("returns unknown ID unchanged", () => {
    expect(resolveAlias("some-unknown-model")).toBe("some-unknown-model");
  });

  it("returns full ID unchanged", () => {
    expect(resolveAlias("claude-opus-4-6")).toBe("claude-opus-4-6");
  });
});

describe("validateModel", () => {
  it("accepts valid model ID", () => {
    expect(validateModel("claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  it("resolves alias then validates", () => {
    expect(validateModel("claude-sonnet-4-5")).toBe("claude-sonnet-4-5-20250929");
  });

  it("throws TaskError for unknown model", () => {
    expect(() => validateModel("gpt-4")).toThrow(TaskError);
  });

  it("error message includes model name", () => {
    expect(() => validateModel("bad-model")).toThrow(/bad-model/);
  });

  it("accepts all SUPPORTED_MODELS", () => {
    for (const m of SUPPORTED_MODELS) {
      expect(validateModel(m.id)).toBe(m.id);
    }
  });
});

describe("setModelOverride / getModel", () => {
  let setModelOverrideLocal: typeof setModelOverride;
  let getModelLocal: typeof getModel;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
    vi.mock("./config.js", () => ({ loadConfig: vi.fn(() => ({})) }));
    const mod = await import("./model.js");
    setModelOverrideLocal = mod.setModelOverride;
    getModelLocal = mod.getModel;
  });

  it("getModel returns null when no override and no config", () => {
    expect(getModelLocal()).toBeNull();
  });

  it("override takes precedence", () => {
    setModelOverrideLocal("claude-opus-4-6");
    expect(getModelLocal()).toBe("claude-opus-4-6");
  });
});

describe("SUPPORTED_MODELS", () => {
  it("is non-empty", () => {
    expect(SUPPORTED_MODELS.length).toBeGreaterThan(0);
  });

  it("each model has id and label", () => {
    for (const m of SUPPORTED_MODELS) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.label).toBe("string");
    }
  });

  it("DEFAULT_MODEL is in SUPPORTED_MODELS", () => {
    const ids = SUPPORTED_MODELS.map((m) => m.id);
    expect(ids).toContain(DEFAULT_MODEL);
  });
});
