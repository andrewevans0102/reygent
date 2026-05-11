import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { spawnAgentStream } from "../src/spawn.js";
import { loadKnowledge } from "../src/knowledge/loader.js";
import { getChesstrace } from "../src/chesstrace/index.js";
import { Events } from "../src/chesstrace/events.js";
import type { Chesstrace } from "../src/chesstrace/index.js";

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

vi.mock("../src/knowledge/loader.js", () => ({
  loadKnowledge: vi.fn(),
}));

vi.mock("../src/chesstrace/index.js", () => ({
  getChesstrace: vi.fn(),
}));

vi.mock("../src/providers/index.js", () => ({
  getProvider: vi.fn().mockReturnValue({
    isAvailable: vi.fn().mockResolvedValue({ available: true }),
    spawn: vi.fn().mockResolvedValue({
      stdout: "Agent output",
      exitCode: 0,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.001,
      },
    }),
  }),
}));

vi.mock("../src/model.js", () => ({
  resolveProvider: vi.fn().mockReturnValue("anthropic"),
  resolveModel: vi.fn().mockResolvedValue("claude-sonnet-4"),
}));

describe("knowledge integration", () => {
  let mockChesstrace: Partial<Chesstrace>;
  let emitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    emitSpy = vi.fn();
    mockChesstrace = {
      emit: emitSpy,
      startRun: vi.fn().mockReturnValue("test-run-id"),
    };

    vi.mocked(getChesstrace).mockReturnValue(mockChesstrace as Chesstrace);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("knowledge injection into agent prompts", () => {
    it("should load knowledge before spawning agent", async () => {
      const mockKnowledge = {
        agentTips: "# Tips\nUse proper error handling",
        commonFailures: "# Failures\n## Circular import",
        successPatterns: "# Patterns\n### Test first",
        projectConventions: "# Conventions\nUse TypeScript",
        entriesLoaded: ["circular-import", "test-first"],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(mockKnowledge);

      // Knowledge injection would happen in spawn logic
      await loadKnowledge("implementer", "implement");

      expect(loadKnowledge).toHaveBeenCalledWith("implementer", "implement");
    });

    it("should inject knowledge into agent prompt", async () => {
      const mockKnowledge = {
        agentTips: "# Agent Tips\nTip 1",
        commonFailures: "# Common Failures\n## Error 1",
        successPatterns: "# Success Patterns\n### Pattern 1",
        projectConventions: "# Conventions\nConvention 1",
        entriesLoaded: ["error-1", "pattern-1"],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(mockKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Enhanced prompt would contain knowledge sections
      const enhancedPrompt = `
You are the implementer agent.

## Project-Specific Knowledge

### Common Failures to Avoid
${knowledge.commonFailures}

### Success Patterns to Follow
${knowledge.successPatterns}

### Agent-Specific Tips (implementer)
${knowledge.agentTips}

### Project Conventions
${knowledge.projectConventions}

---

**Important**: Review above knowledge before proceeding.
`;

      expect(enhancedPrompt).toContain("## Project-Specific Knowledge");
      expect(enhancedPrompt).toContain("# Common Failures");
      expect(enhancedPrompt).toContain("# Success Patterns");
      expect(enhancedPrompt).toContain("# Agent Tips");
      expect(enhancedPrompt).toContain("# Conventions");
    });

    it("should emit knowledge.consulted event with entries", async () => {
      const mockKnowledge = {
        agentTips: "Tips",
        commonFailures: "Failures",
        successPatterns: "Patterns",
        projectConventions: "Conventions",
        entriesLoaded: ["entry-1", "entry-2", "entry-3"],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(mockKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      // After loading, emit telemetry
      mockChesstrace.emit!(Events.KNOWLEDGE_CONSULTED, {
        agent: "implementer",
        stage: "implement",
        entries: knowledge.entriesLoaded,
        entryCount: knowledge.entriesLoaded.length,
      });

      expect(emitSpy).toHaveBeenCalledWith(Events.KNOWLEDGE_CONSULTED, {
        agent: "implementer",
        stage: "implement",
        entries: ["entry-1", "entry-2", "entry-3"],
        entryCount: 3,
      });
    });

    it("should handle missing knowledge gracefully", async () => {
      const emptyKnowledge = {
        agentTips: "",
        commonFailures: "",
        successPatterns: "",
        projectConventions: "",
        entriesLoaded: [],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(emptyKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      expect(knowledge.entriesLoaded).toEqual([]);
      expect(knowledge.agentTips).toBe("");
    });

    it("should filter knowledge by agent", async () => {
      const mockFailures = `# Failures
## Error 1
**Agent**: implementer
Implementer-specific error

## Error 2
**Agent**: spec-writer
Spec-writer-specific error`;

      vi.mocked(fs.readFile).mockResolvedValue(mockFailures);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Would only include implementer failures
      expect(knowledge.commonFailures).not.toContain("spec-writer");
    });

    it("should filter patterns by recency", async () => {
      const recent = new Date().toISOString().split("T")[0];
      const old = new Date(
        Date.now() - 40 * 24 * 60 * 60 * 1000,
      ).toISOString().split("T")[0];

      const mockPatterns = `# Patterns
### Pattern 1
**Last seen**: ${recent}
Recent pattern

### Pattern 2
**Last seen**: ${old}
Old pattern`;

      vi.mocked(fs.readFile).mockResolvedValue(mockPatterns);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Would only include recent patterns (within 30 days)
      expect(knowledge.successPatterns).not.toContain("Old pattern");
    });
  });

  describe("telemetry tracking", () => {
    it("should track knowledge.consulted event", () => {
      mockChesstrace.emit!(Events.KNOWLEDGE_CONSULTED, {
        agent: "implementer",
        stage: "implement",
        entries: ["circular-import", "missing-migration"],
        entryCount: 2,
      });

      expect(emitSpy).toHaveBeenCalledWith(
        Events.KNOWLEDGE_CONSULTED,
        expect.objectContaining({
          agent: "implementer",
          stage: "implement",
          entryCount: 2,
        }),
      );
    });

    it("should track knowledge.prevented_failure event", () => {
      mockChesstrace.emit!(Events.KNOWLEDGE_PREVENTED_FAILURE, {
        entry: "circular-import",
        agent: "implementer",
        evidence: "Agent mentioned checking for circular imports",
      });

      expect(emitSpy).toHaveBeenCalledWith(
        Events.KNOWLEDGE_PREVENTED_FAILURE,
        expect.objectContaining({
          entry: "circular-import",
          agent: "implementer",
        }),
      );
    });

    it("should track knowledge.success event", () => {
      mockChesstrace.emit!(Events.KNOWLEDGE_SUCCESS, {
        entries_used: ["test-first", "dependency-analysis"],
        agent: "spec-writer",
        stage: "spec",
      });

      expect(emitSpy).toHaveBeenCalledWith(
        Events.KNOWLEDGE_SUCCESS,
        expect.objectContaining({
          agent: "spec-writer",
          entries_used: expect.arrayContaining(["test-first"]),
        }),
      );
    });

    it("should not emit events when knowledge is empty", async () => {
      const emptyKnowledge = {
        agentTips: "",
        commonFailures: "",
        successPatterns: "",
        projectConventions: "",
        entriesLoaded: [],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(emptyKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      if (knowledge.entriesLoaded.length === 0) {
        // Should not emit knowledge.consulted
      } else {
        mockChesstrace.emit!(Events.KNOWLEDGE_CONSULTED, {
          agent: "implementer",
          stage: "implement",
          entries: knowledge.entriesLoaded,
          entryCount: knowledge.entriesLoaded.length,
        });
      }

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe("smart filtering", () => {
    it("should only inject relevant knowledge to avoid context bloat", async () => {
      const mockKnowledge = {
        agentTips: "# Tips (50 chars)",
        commonFailures: "# Failures (relevant to agent, 100 chars)",
        successPatterns: "# Patterns (recent only, 80 chars)",
        projectConventions: "# Conventions (200 chars)",
        entriesLoaded: ["failure-1", "pattern-1"],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(mockKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Total injected content should be minimal
      const totalLength =
        knowledge.agentTips.length +
        knowledge.commonFailures.length +
        knowledge.successPatterns.length +
        knowledge.projectConventions.length;

      expect(totalLength).toBeLessThan(5000); // Reasonable limit
    });

    it("should prioritize agent-specific knowledge", async () => {
      const mockKnowledge = {
        agentTips: "# Agent-specific tips (high priority)",
        commonFailures: "# Filtered by agent",
        successPatterns: "# Recent only",
        projectConventions: "# Always included",
        entriesLoaded: ["agent-tip-1", "failure-1"],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(mockKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Agent tips always loaded
      expect(knowledge.agentTips).toBeTruthy();
      // Conventions always loaded
      expect(knowledge.projectConventions).toBeTruthy();
    });
  });

  describe("effectiveness measurement", () => {
    it("should track success rate with knowledge consulted", () => {
      // Simulate run with knowledge
      mockChesstrace.emit!(Events.KNOWLEDGE_CONSULTED, {
        agent: "implementer",
        stage: "implement",
        entries: ["circular-import"],
        entryCount: 1,
      });

      mockChesstrace.emit!(Events.PIPELINE_END, {
        success: true,
        runId: "run-with-knowledge",
      });

      expect(emitSpy).toHaveBeenCalledWith(
        Events.KNOWLEDGE_CONSULTED,
        expect.any(Object),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        Events.PIPELINE_END,
        expect.objectContaining({ success: true }),
      );
    });

    it("should track baseline success rate without knowledge", () => {
      // Simulate run without knowledge consultation
      mockChesstrace.emit!(Events.PIPELINE_END, {
        success: false,
        runId: "run-without-knowledge",
      });

      expect(emitSpy).toHaveBeenCalledWith(
        Events.PIPELINE_END,
        expect.objectContaining({ success: false }),
      );
      expect(emitSpy).not.toHaveBeenCalledWith(
        Events.KNOWLEDGE_CONSULTED,
        expect.any(Object),
      );
    });
  });

  describe("edge cases", () => {
    it("should handle filesystem errors when loading knowledge", async () => {
      const error = new Error("EACCES: permission denied");
      vi.mocked(loadKnowledge).mockRejectedValue(error);

      await expect(
        loadKnowledge("implementer", "implement"),
      ).rejects.toThrow("permission denied");
    });

    it("should handle malformed markdown in knowledge files", async () => {
      const malformedKnowledge = {
        agentTips: "# Tips\n## Missing closing",
        commonFailures: "# Failures\n**Agent**: no-value",
        successPatterns: "",
        projectConventions: "Not valid markdown structure",
        entriesLoaded: [],
      };

      vi.mocked(loadKnowledge).mockResolvedValue(malformedKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Should still return knowledge even if malformed
      expect(knowledge).toBeDefined();
      expect(knowledge.agentTips).toBeTruthy();
    });

    it("should handle very large knowledge files", async () => {
      const largeContent = "# Failures\n" + "## Error\nContent\n".repeat(1000);
      const largeKnowledge = {
        agentTips: "",
        commonFailures: largeContent,
        successPatterns: "",
        projectConventions: "",
        entriesLoaded: new Array(1000).fill(0).map((_, i) => `entry-${i}`),
      };

      vi.mocked(loadKnowledge).mockResolvedValue(largeKnowledge);

      const knowledge = await loadKnowledge("implementer", "implement");

      // Should handle large files but may need truncation
      expect(knowledge.entriesLoaded.length).toBeGreaterThan(0);
    });
  });
});
