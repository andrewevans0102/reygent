import { describe, it, expect } from "vitest";
import { extractTokenUsage } from "./claude.js";
import type { StreamResultMessage } from "./claude.js";

/**
 * Tests for per-provider cache token extraction (DT-275).
 *
 * Each provider returns cache metadata in a different format.
 * These tests verify that each provider's output parser extracts
 * cachedTokens and cacheWriteTokens correctly and maps them
 * into the UsageInfo shape.
 */

// ── Helper ──────────────────────────────────────────────────────

function makeResultMsg(
  overrides: Partial<StreamResultMessage> = {},
): StreamResultMessage {
  return {
    type: "result",
    subtype: "success",
    result: "",
    ...overrides,
  };
}

// ── Claude Provider ─────────────────────────────────────────────

describe("Claude provider cache extraction", () => {
  describe("extractTokenUsage returns separate cache fields", () => {
    it("extracts cache_read_input_tokens as cachedTokens", () => {
      const msg = makeResultMsg({
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_read_input_tokens: 3100,
        },
      });
      const result = extractTokenUsage(msg);
      expect(result.inputTokens).toBeDefined();
      expect(result.cachedTokens).toBe(3100);
    });

    it("extracts cache_creation_input_tokens as cacheWriteTokens", () => {
      const msg = makeResultMsg({
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_input_tokens: 900,
        },
      });
      const result = extractTokenUsage(msg);
      expect(result.cacheWriteTokens).toBe(900);
    });

    it("returns both cache fields when present", () => {
      const msg = makeResultMsg({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 150,
          cache_read_input_tokens: 200,
        },
      });
      const result = extractTokenUsage(msg);
      expect(result.cachedTokens).toBe(200);
      expect(result.cacheWriteTokens).toBe(150);
    });

    it("returns 0 for cache fields when they are 0 in response", () => {
      const msg = makeResultMsg({
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });
      const result = extractTokenUsage(msg);
      expect(result.cachedTokens).toBe(0);
      expect(result.cacheWriteTokens).toBe(0);
    });

    it("returns undefined for cache fields when usage object is missing", () => {
      const msg = makeResultMsg();
      const result = extractTokenUsage(msg);
      expect(result.cachedTokens).toBeUndefined();
      expect(result.cacheWriteTokens).toBeUndefined();
    });

    it("returns undefined for cache fields when only top-level tokens exist", () => {
      const msg = makeResultMsg({
        input_tokens: 500,
        output_tokens: 200,
      });
      const result = extractTokenUsage(msg);
      // No usage.cache_* fields → cache fields should be undefined
      expect(result.cachedTokens).toBeUndefined();
      expect(result.cacheWriteTokens).toBeUndefined();
    });

    it("still computes total inputTokens including cache tokens", () => {
      const msg = makeResultMsg({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 150,
          cache_read_input_tokens: 200,
        },
      });
      const result = extractTokenUsage(msg);
      // inputTokens = base + creation + read = 100 + 150 + 200 = 450
      expect(result.inputTokens).toBe(450);
    });
  });
});
