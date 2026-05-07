import { describe, it, expect } from "vitest";
import { PROVIDER_PRICING, type ProviderName } from "./pricing.js";
import type { ProviderName as ProvidersProviderName } from "./providers/types.js";

describe("PROVIDER_PRICING", () => {
  const providers: ProviderName[] = ["claude", "codex", "openrouter", "gemini"];

  it("includes all expected providers", () => {
    expect(Object.keys(PROVIDER_PRICING).sort()).toEqual(providers.sort());
  });

  it("ProviderName type matches providers/types.ts", () => {
    // Type-level check: ensure pricing.ts and providers/types.ts use same ProviderName
    const testProviderName: ProviderName = "claude";
    const testProviderName2: ProvidersProviderName = testProviderName;
    expect(testProviderName2).toBe("claude");
  });

  describe.each(providers)("%s", (provider) => {
    it("has valid inputCostPerMillion", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.inputCostPerMillion).toBeTypeOf("number");
      expect(pricing.inputCostPerMillion).toBeGreaterThan(0);
    });

    it("has valid outputCostPerMillion", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.outputCostPerMillion).toBeTypeOf("number");
      expect(pricing.outputCostPerMillion).toBeGreaterThan(0);
    });

    it("has valid cacheDiscountRate", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.cacheDiscountRate).toBeTypeOf("number");
      expect(pricing.cacheDiscountRate).toBeGreaterThanOrEqual(0);
      expect(pricing.cacheDiscountRate).toBeLessThanOrEqual(1);
    });

    it("has supportsCaching boolean", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.supportsCaching).toBeTypeOf("boolean");
    });

    it("has non-empty defaultModel", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.defaultModel).toBeTypeOf("string");
      expect(pricing.defaultModel.length).toBeGreaterThan(0);
    });

    it("has valid HTTPS pricingUrl", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.pricingUrl).toBeTypeOf("string");
      expect(pricing.pricingUrl).toMatch(/^https:\/\/.+/);
    });

    it("has lastVerified in ISO format", () => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.lastVerified).toBeTypeOf("string");
      expect(pricing.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(pricing.lastVerified);
      expect(date.toString()).not.toBe("Invalid Date");
    });
  });

  it("output cost always higher than input cost", () => {
    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing.outputCostPerMillion).toBeGreaterThan(
        pricing.inputCostPerMillion
      );
    });
  });
});
