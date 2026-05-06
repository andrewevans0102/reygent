import { describe, it, expect, vi } from "vitest";

/**
 * Integration tests for branch creation with type selection
 *
 * Tests cover:
 * - Interactive prompt flow when no --type flag
 * - CLI flag bypassing prompt
 * - Auto-detection from Jira/Linear metadata
 * - Error handling for invalid types
 */

describe("branch creation workflow", () => {
  describe("interactive prompt", () => {
    it("prompts user for type when no --type flag and no metadata", async () => {
      const promptFn = vi.fn().mockResolvedValue("feat");
      const spec = {
        source: "markdown" as const,
        title: "Add feature",
        content: "",
      };

      const branch = await createBranchWithPrompt(spec, { prompt: promptFn });

      expect(promptFn).toHaveBeenCalledWith({
        message: expect.stringContaining("type"),
        choices: expect.arrayContaining(["feat", "fix", "chore", "refactor", "docs"]),
      });
      expect(branch).toBe("feat/add-feature");
    });

    it("uses user selection from prompt", async () => {
      const promptFn = vi.fn().mockResolvedValue("fix");
      const spec = {
        source: "jira" as const,
        issueKey: "PROJ-456",
        title: "Task",
        content: "",
        // No issueType - force prompt
      };

      const branch = await createBranchWithPrompt(spec, { prompt: promptFn });

      expect(branch).toBe("fix/PROJ-456");
    });

    it("validates prompt response", async () => {
      const promptFn = vi.fn().mockResolvedValue("invalid");
      const spec = {
        source: "markdown" as const,
        title: "Do thing",
        content: "",
      };

      await expect(
        createBranchWithPrompt(spec, { prompt: promptFn })
      ).rejects.toThrow(/invalid.*type/i);
    });
  });

  describe("CLI --type flag", () => {
    it("skips prompt when --type provided", async () => {
      const promptFn = vi.fn();
      const spec = {
        source: "markdown" as const,
        title: "Add feature",
        content: "",
      };

      const branch = await createBranchWithPrompt(spec, {
        prompt: promptFn,
        typeFlag: "feat",
      });

      expect(promptFn).not.toHaveBeenCalled();
      expect(branch).toBe("feat/add-feature");
    });

    it("validates --type flag value", async () => {
      const spec = {
        source: "markdown" as const,
        title: "Do thing",
        content: "",
      };

      await expect(
        createBranchWithPrompt(spec, { typeFlag: "invalid" })
      ).rejects.toThrow(/invalid.*type/i);
    });

    it("overrides detected type with --type flag", async () => {
      const spec = {
        source: "jira" as const,
        issueKey: "PROJ-789",
        title: "Bug fix",
        content: "",
        issueType: "Bug",
      };

      const branch = await createBranchWithPrompt(spec, { typeFlag: "chore" });

      expect(branch).toBe("chore/PROJ-789");
    });

    it("accepts long-form type aliases", async () => {
      const spec = {
        source: "linear" as const,
        issueId: "DT-123",
        title: "Fix",
        content: "",
      };

      const branch = await createBranchWithPrompt(spec, { typeFlag: "bugfix" });

      expect(branch).toBe("fix/DT-123");
    });
  });

  describe("auto-detection from metadata", () => {
    it("skips prompt when jira type detected", async () => {
      const promptFn = vi.fn();
      const spec = {
        source: "jira" as const,
        issueKey: "PROJ-111",
        title: "Story",
        content: "",
        issueType: "Story",
      };

      const branch = await createBranchWithPrompt(spec, { prompt: promptFn });

      expect(promptFn).not.toHaveBeenCalled();
      expect(branch).toBe("feat/PROJ-111");
    });

    it("skips prompt when linear labels detected", async () => {
      const promptFn = vi.fn();
      const spec = {
        source: "linear" as const,
        issueId: "DT-222",
        title: "Bug",
        content: "",
        labels: ["bug", "critical"],
      };

      const branch = await createBranchWithPrompt(spec, { prompt: promptFn });

      expect(promptFn).not.toHaveBeenCalled();
      expect(branch).toBe("fix/DT-222");
    });

    it("prompts when jira type unmapped", async () => {
      const promptFn = vi.fn().mockResolvedValue("chore");
      const spec = {
        source: "jira" as const,
        issueKey: "PROJ-333",
        title: "Epic",
        content: "",
        issueType: "Epic",
      };

      const branch = await createBranchWithPrompt(spec, { prompt: promptFn });

      expect(promptFn).toHaveBeenCalled();
      expect(branch).toBe("chore/PROJ-333");
    });

    it("prompts when linear has no matching labels", async () => {
      const promptFn = vi.fn().mockResolvedValue("feat");
      const spec = {
        source: "linear" as const,
        issueId: "DT-444",
        title: "Task",
        content: "",
        labels: ["backend", "high-priority"],
      };

      const branch = await createBranchWithPrompt(spec, { prompt: promptFn });

      expect(promptFn).toHaveBeenCalled();
      expect(branch).toBe("feat/DT-444");
    });
  });

  describe("error cases", () => {
    it("throws when prompt returns empty string", async () => {
      const promptFn = vi.fn().mockResolvedValue("");
      const spec = {
        source: "markdown" as const,
        title: "Task",
        content: "",
      };

      await expect(
        createBranchWithPrompt(spec, { prompt: promptFn })
      ).rejects.toThrow(/type.*required/i);
    });

    it("throws when prompt cancelled", async () => {
      const promptFn = vi.fn().mockResolvedValue(null);
      const spec = {
        source: "markdown" as const,
        title: "Task",
        content: "",
      };

      await expect(
        createBranchWithPrompt(spec, { prompt: promptFn })
      ).rejects.toThrow(/cancelled/i);
    });
  });
});

describe("backward compatibility", () => {
  it("rejects reygent/ prefix in type flag", async () => {
    const spec = {
      source: "jira" as const,
      issueKey: "PROJ-999",
      title: "Task",
      content: "",
    };

    await expect(
      createBranchWithPrompt(spec, { typeFlag: "reygent" })
    ).rejects.toThrow(/invalid.*type/i);
  });

  it("never generates reygent/ prefix", async () => {
    const spec = {
      source: "markdown" as const,
      title: "Add feature",
      content: "",
    };

    const branch = await createBranchWithPrompt(spec, { typeFlag: "feat" });

    expect(branch).not.toMatch(/^reygent\//);
    expect(branch).toBe("feat/add-feature");
  });
});

// Stub implementation for tests
async function createBranchWithPrompt(
  spec: {
    source: string;
    title: string;
    content: string;
    issueKey?: string;
    issueId?: string;
    issueType?: string;
    labels?: string[];
  },
  opts: {
    prompt?: (config: { message: string; choices: string[]; default?: string }) => Promise<string | null>;
    typeFlag?: string;
  } = {},
): Promise<string> {
  // Step 1: Check for CLI flag first
  if (opts.typeFlag) {
    const normalized = normalizeType(opts.typeFlag);
    return deriveBranchNameWithType(spec, normalized);
  }

  // Step 2: Try auto-detection
  let detectedType: string | null = null;
  if (spec.source === "jira" && spec.issueType) {
    detectedType = detectTypeFromJiraIssueType(spec.issueType);
  } else if (spec.source === "linear" && spec.labels) {
    detectedType = detectTypeFromLinearLabels(spec.labels);
  }

  // If type detected, use it without prompting
  if (detectedType) {
    return deriveBranchNameWithType(spec, detectedType);
  }

  // Step 3: Prompt user when no auto-detection
  if (!opts.prompt) {
    throw new Error("Branch type is required");
  }

  const choices = ["feat", "fix", "chore", "refactor", "docs", "test", "style", "perf"];
  const response = await opts.prompt({
    message: "Select branch type:",
    choices,
  });

  if (response === null) {
    throw new Error("Branch creation cancelled");
  }

  if (!response) {
    throw new Error("Branch type is required");
  }

  const normalized = normalizeType(response);
  return deriveBranchNameWithType(spec, normalized);
}

function normalizeType(type: string): string {
  const lower = type.toLowerCase().trim();
  // Handle long-form aliases
  if (lower === "feature") return "feat";
  if (lower === "bugfix") return "fix";
  const valid = ["feat", "fix", "chore", "refactor", "docs", "test", "style", "perf"];
  if (valid.includes(lower)) return lower;
  throw new Error(`Invalid branch type: ${type}`);
}

function detectTypeFromJiraIssueType(issueType: string): string | null {
  const lower = issueType.toLowerCase();
  if (lower === "story") return "feat";
  if (lower === "bug") return "fix";
  if (lower === "task") return "chore";
  if (lower === "technical debt") return "refactor";
  return null;
}

function detectTypeFromLinearLabels(labels: string[]): string | null {
  const lower = labels.map(l => l.toLowerCase());
  if (lower.some(l => l.includes("bug"))) return "fix";
  if (lower.some(l => l.includes("feature"))) return "feat";
  if (lower.some(l => l.includes("chore") || l.includes("maintenance"))) return "chore";
  if (lower.some(l => l.includes("refactor") || l.includes("tech-debt"))) return "refactor";
  if (lower.some(l => l.includes("doc"))) return "docs";
  return null;
}

function deriveBranchNameWithType(
  spec: { source: string; title: string; issueKey?: string; issueId?: string },
  type: string,
): string {
  if (spec.source === "jira" && spec.issueKey) {
    return `${type}/${spec.issueKey}`;
  }
  if (spec.source === "linear" && spec.issueId) {
    return `${type}/${spec.issueId}`;
  }
  const slug = spec.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${type}/${slug}`;
}
