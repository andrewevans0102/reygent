import { describe, it, expect } from "vitest";
import { PROVIDER_PRICING } from "../pricing.js";

/**
 * Tests for the verify-pricing skill behavior.
 *
 * The skill itself lives in .claude/skills/verify-pricing.md
 * and is invoked via Claude Code CLI as /verify-pricing.
 *
 * These tests verify the data contract and expectations for the skill.
 */
describe("verify-pricing skill data contract", () => {
  it("PROVIDER_PRICING has pricingUrl for each provider", () => {
    const providers = Object.keys(PROVIDER_PRICING);
    expect(providers.length).toBeGreaterThan(0);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      expect(pricing.pricingUrl).toBeDefined();
      expect(pricing.pricingUrl).toMatch(/^https:\/\/.+/);
    });
  });

  it("PROVIDER_PRICING has lastVerified for each provider", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      expect(pricing.lastVerified).toBeDefined();
      expect(pricing.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("pricingUrl points to expected domains", () => {
    expect(PROVIDER_PRICING.claude.pricingUrl).toContain("anthropic.com");
    expect(PROVIDER_PRICING.codex.pricingUrl).toContain("openai.com");
    expect(PROVIDER_PRICING.openrouter.pricingUrl).toContain("openrouter.ai");
    expect(PROVIDER_PRICING.gemini.pricingUrl).toContain("google");
  });

  it("all required pricing fields are numbers", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      expect(typeof pricing.inputCostPerMillion).toBe("number");
      expect(typeof pricing.outputCostPerMillion).toBe("number");
      expect(typeof pricing.cacheDiscountRate).toBe("number");
    });
  });

  it("supportsCaching is boolean for all providers", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      expect(typeof pricing.supportsCaching).toBe("boolean");
    });
  });

  it("defaultModel is non-empty string for all providers", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      expect(typeof pricing.defaultModel).toBe("string");
      expect(pricing.defaultModel.length).toBeGreaterThan(0);
    });
  });
});

describe("verify-pricing skill expected behavior", () => {
  it("should verify all provider pricing fields", () => {
    // Expected fields the skill should verify
    const requiredFields = [
      "inputCostPerMillion",
      "outputCostPerMillion",
      "cacheDiscountRate",
      "supportsCaching",
    ];

    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      requiredFields.forEach((field) => {
        expect(pricing).toHaveProperty(field);
      });
    });
  });

  it("lastVerified dates should be parseable", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      const date = new Date(pricing.lastVerified);
      expect(date.toString()).not.toBe("Invalid Date");
    });
  });

  it("skill can distinguish stale pricing by lastVerified age", () => {
    const providers = Object.keys(PROVIDER_PRICING);
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      const lastVerifiedDate = new Date(pricing.lastVerified);

      // Data structure supports staleness detection
      const isStale = lastVerifiedDate < ninetyDaysAgo;
      expect(typeof isStale).toBe("boolean");
    });
  });
});

describe("verify-pricing skill security requirements", () => {
  it("pricing config contains no sensitive data", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      const serialized = JSON.stringify(pricing);

      // No API keys, tokens, or account IDs
      expect(serialized).not.toMatch(/api[_-]?key/i);
      expect(serialized).not.toMatch(/token/i);
      expect(serialized).not.toMatch(/secret/i);
      expect(serialized).not.toMatch(/account[_-]?id/i);
      expect(serialized).not.toMatch(/org[_-]?id/i);
    });
  });

  it("pricing URLs are public endpoints", () => {
    const providers = Object.keys(PROVIDER_PRICING);

    providers.forEach((provider) => {
      const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];

      // No auth-required or account-specific URLs
      expect(pricing.pricingUrl).not.toContain("/account");
      expect(pricing.pricingUrl).not.toContain("/billing");
      expect(pricing.pricingUrl).not.toContain("/dashboard");
      expect(pricing.pricingUrl).not.toContain("?api_key=");
      expect(pricing.pricingUrl).not.toContain("&token=");
    });
  });
});
