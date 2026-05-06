import { describe, it, expect, vi } from "vitest";
import { promptForType, normalizeType, VALID_BRANCH_TYPES, type BranchType } from "./branch-type.js";

/**
 * Tests for interactive type selection prompt
 *
 * Tests cover:
 * - Prompt display with correct choices
 * - Default value when type auto-detected
 * - User selection handling
 * - Cancellation handling
 * - Validation of prompt response
 */

describe("type selection prompt", () => {
  describe("prompt choices", () => {
    it("offers all conventional types as choices", async () => {
      const promptFn = vi.fn().mockResolvedValue("feat");
      await testPromptForType(promptFn, null);

      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: expect.arrayContaining([
            "feat",
            "fix",
            "chore",
            "refactor",
            "docs",
            "test",
            "style",
            "perf",
          ]),
        })
      );
    });

    it("displays message asking for type", async () => {
      const promptFn = vi.fn().mockResolvedValue("feat");
      await testPromptForType(promptFn, null);

      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/type|branch/i),
        })
      );
    });
  });

  describe("default value", () => {
    it("sets no default when no type detected", async () => {
      const promptFn = vi.fn().mockResolvedValue("feat");
      await testPromptForType(promptFn, null);

      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          default: undefined,
        })
      );
    });

    it("sets feat as default when Story detected", async () => {
      const promptFn = vi.fn().mockResolvedValue("feat");
      await testPromptForType(promptFn, "feat");

      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          default: "feat",
        })
      );
    });

    it("sets fix as default when Bug detected", async () => {
      const promptFn = vi.fn().mockResolvedValue("fix");
      await testPromptForType(promptFn, "fix");

      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          default: "fix",
        })
      );
    });

    it("sets chore as default when Task detected", async () => {
      const promptFn = vi.fn().mockResolvedValue("chore");
      await testPromptForType(promptFn, "chore");

      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          default: "chore",
        })
      );
    });
  });

  describe("user selection", () => {
    it("returns normalized type from feature selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("feature");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("feat");
    });

    it("returns normalized type from bugfix selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("bugfix");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("fix");
    });

    it("returns chore from selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("chore");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("chore");
    });

    it("returns refactor from selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("refactor");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("refactor");
    });

    it("returns docs from selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("docs");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("docs");
    });

    it("returns test from selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("test");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("test");
    });

    it("returns style from selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("style");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("style");
    });

    it("returns perf from selection", async () => {
      const promptFn = vi.fn().mockResolvedValue("perf");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("perf");
    });
  });

  describe("cancellation", () => {
    it("throws when user cancels prompt (returns null)", async () => {
      const promptFn = vi.fn().mockResolvedValue(null);
      await expect(promptForType(promptFn, null)).rejects.toThrow(/cancel/i);
    });

    it("throws when prompt returns undefined", async () => {
      const promptFn = vi.fn().mockResolvedValue(undefined);
      await expect(promptForType(promptFn, null)).rejects.toThrow(/type.*required/i);
    });
  });

  describe("validation", () => {
    it("throws on empty string response", async () => {
      const promptFn = vi.fn().mockResolvedValue("");
      await expect(promptForType(promptFn, null)).rejects.toThrow(/type.*required/i);
    });

    it("throws on invalid type response", async () => {
      const promptFn = vi.fn().mockResolvedValue("invalid");
      await expect(promptForType(promptFn, null)).rejects.toThrow(/invalid.*type/i);
    });

    it("accepts whitespace-padded valid type", async () => {
      const promptFn = vi.fn().mockResolvedValue("  feat  ");
      const result = await testPromptForType(promptFn, null);
      expect(result).toBe("feat");
    });
  });
});

describe("prompt integration scenarios", () => {
  it("uses default when user presses enter", async () => {
    const promptFn = vi.fn().mockResolvedValue("feat");
    await testPromptForType(promptFn, "feat");

    expect(promptFn).toHaveBeenCalledWith(
      expect.objectContaining({
        default: "feat",
      })
    );
  });

  it("overrides default when user makes different selection", async () => {
    const promptFn = vi.fn().mockResolvedValue("fix");
    const result = await testPromptForType(promptFn, "feat");
    expect(result).toBe("fix");
  });

  it("prompt not called when skip option set", async () => {
    const promptFn = vi.fn();
    const result = await testPromptForType(promptFn, "feat", { skipPrompt: true });
    expect(promptFn).not.toHaveBeenCalled();
    expect(result).toBe("feat");
  });

  it("throws when skip set but no detected type", async () => {
    const promptFn = vi.fn();
    await expect(
      promptForType(promptFn, null, { skipPrompt: true })
    ).rejects.toThrow(/type.*required/i);
  });
});

// Test wrapper to adapt promptForType signature to test mock interface
async function testPromptForType(
  promptFn: (config: { message: string; choices: string[]; default?: string }) => Promise<string | null | undefined>,
  detectedType: BranchType | null,
  opts: { skipPrompt?: boolean } = {},
): Promise<BranchType> {
  // Adapt mock interface to real interface
  const adaptedFn = async (config: { message: string; choices: { name: string; value: string }[]; default?: string }) => {
    // Extract values for mock
    const simpleChoices = config.choices.map(c => c.value);
    return promptFn({ message: config.message, choices: simpleChoices, default: config.default });
  };
  return promptForType(adaptedFn, detectedType, opts);
}
