import { describe, it, expect } from "vitest";
import { extractTokenUsage } from "./claude.js";
import type { StreamResultMessage } from "./claude.js";

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

describe("extractTokenUsage", () => {
  it("returns 0 when all token fields are present but zero", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBe(0);
    expect(outputTokens).toBe(0);
  });

  it("returns undefined when usage object is missing entirely", () => {
    const msg = makeResultMsg();
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBeUndefined();
    expect(outputTokens).toBeUndefined();
  });

  it("sums partial cache fields correctly (only cache_read present)", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 200,
      },
    });
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBe(300);
    expect(outputTokens).toBe(50);
  });

  it("sums all cache fields", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 150,
        cache_read_input_tokens: 200,
      },
    });
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBe(450);
    expect(outputTokens).toBe(50);
  });

  it("falls back to top-level input_tokens when usage missing", () => {
    const msg = makeResultMsg({
      input_tokens: 500,
      output_tokens: 250,
    });
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBe(500);
    expect(outputTokens).toBe(250);
  });

  it("prefers usage.input_tokens over top-level input_tokens", () => {
    const msg = makeResultMsg({
      input_tokens: 999,
      output_tokens: 999,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    });
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBe(100);
    expect(outputTokens).toBe(50);
  });

  it("handles usage present but with only cache fields (no base input_tokens)", () => {
    const msg = makeResultMsg({
      usage: {
        cache_creation_input_tokens: 300,
      },
    });
    const { inputTokens, outputTokens } = extractTokenUsage(msg);
    expect(inputTokens).toBe(300);
    expect(outputTokens).toBeUndefined();
  });

  it("returns cachedTokens from cache_read_input_tokens", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 200,
      },
    });
    const { cachedTokens } = extractTokenUsage(msg);
    expect(cachedTokens).toBe(200);
  });

  it("returns cacheWriteTokens from cache_creation_input_tokens", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 150,
      },
    });
    const { cacheWriteTokens } = extractTokenUsage(msg);
    expect(cacheWriteTokens).toBe(150);
  });

  it("returns both cachedTokens and cacheWriteTokens when present", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 150,
        cache_read_input_tokens: 200,
      },
    });
    const { cachedTokens, cacheWriteTokens } = extractTokenUsage(msg);
    expect(cachedTokens).toBe(200);
    expect(cacheWriteTokens).toBe(150);
  });

  it("returns undefined cachedTokens when no cache_read_input_tokens", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    });
    const { cachedTokens, cacheWriteTokens } = extractTokenUsage(msg);
    expect(cachedTokens).toBeUndefined();
    expect(cacheWriteTokens).toBeUndefined();
  });

  it("returns 0 cachedTokens when cache_read_input_tokens is 0", () => {
    const msg = makeResultMsg({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    const { cachedTokens, cacheWriteTokens } = extractTokenUsage(msg);
    expect(cachedTokens).toBe(0);
    expect(cacheWriteTokens).toBe(0);
  });
});
