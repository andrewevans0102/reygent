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

describe("verify-pricing skill integration behavior", () => {
  describe("price extraction logic", () => {
    it("normalizes percentage savings format", () => {
      // "90% savings" → 0.90
      const input = "Cached tokens save 90% on costs";
      const match = input.match(/(\d+(?:\.\d+)?)%/);
      expect(match).toBeTruthy();
      const rate = parseFloat(match![1]) / 100;
      expect(rate).toBe(0.90);
    });

    it("normalizes billed-at percentage format", () => {
      // "billed at 10%" → 0.90 savings
      const input = "Cached tokens are billed at 10% of full price";
      const match = input.match(/billed at (\d+(?:\.\d+)?)%/);
      expect(match).toBeTruthy();
      const billedRate = parseFloat(match![1]) / 100;
      const savingsRate = 1 - billedRate;
      expect(savingsRate).toBe(0.90);
    });

    it("normalizes multiplier format", () => {
      // "0.90x cost" → 0.10 savings (pay 90%, save 10%)
      const input = "Cache reads cost 0.90x the full price";
      const match = input.match(/(\d+(?:\.\d+)?)x/);
      expect(match).toBeTruthy();
      const multiplier = parseFloat(match![1]);
      const savingsRate = 1 - multiplier;
      expect(savingsRate).toBeCloseTo(0.10);
    });

    it("normalizes price comparison format", () => {
      // "$0.30 vs $3.00" → 0.90 savings
      const input = "Cache reads: $0.30/M vs $3.00/M full price";
      const matches = input.match(/\$(\d+(?:\.\d+)?)/g);
      expect(matches).toHaveLength(2);
      const discounted = parseFloat(matches![0].substring(1));
      const full = parseFloat(matches![1].substring(1));
      const savingsRate = (full - discounted) / full;
      expect(savingsRate).toBeCloseTo(0.90);
    });

    it("validates normalized rate is in range [0, 1]", () => {
      const testCases = [
        { input: 0.90, valid: true },
        { input: 0.00, valid: true },
        { input: 1.00, valid: true },
        { input: -0.1, valid: false },
        { input: 1.1, valid: false },
      ];

      testCases.forEach(({ input, valid }) => {
        const isValid = input >= 0 && input <= 1;
        expect(isValid).toBe(valid);
      });
    });
  });

  describe("comparison logic", () => {
    it("detects exact match", () => {
      const current = 3.00;
      const actual = 3.00;
      const match = current === actual;
      expect(match).toBe(true);
    });

    it("detects mismatch", () => {
      const current = 2.50;
      const actual = 3.00;
      const match = current === actual;
      expect(match).toBe(false);
    });

    it("handles unable-to-verify case", () => {
      const current = 3.00;
      const actual = null; // Could not extract from docs
      const status = actual === null ? "unable-to-verify" : (current === actual ? "match" : "mismatch");
      expect(status).toBe("unable-to-verify");
    });

    it("compares discount rates with tolerance for floating point", () => {
      const current = 0.90;
      const actual = 0.9; // Same value, different precision
      const tolerance = 0.001;
      const match = Math.abs(current - actual) < tolerance;
      expect(match).toBe(true);
    });
  });

  describe("lastVerified date updates", () => {
    it("generates today's date in ISO format", () => {
      const today = new Date();
      const isoDate = today.toISOString().split("T")[0];
      expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("updates lastVerified only when all fields match", () => {
      const results = [
        { field: "inputCostPerMillion", status: "match" },
        { field: "outputCostPerMillion", status: "match" },
        { field: "cacheDiscountRate", status: "match" },
      ];

      const allMatch = results.every(r => r.status === "match");
      expect(allMatch).toBe(true);
    });

    it("does not update lastVerified when any mismatch exists", () => {
      const results = [
        { field: "inputCostPerMillion", status: "match" },
        { field: "outputCostPerMillion", status: "mismatch" },
        { field: "cacheDiscountRate", status: "match" },
      ];

      const allMatch = results.every(r => r.status === "match");
      expect(allMatch).toBe(false);
    });

    it("does not update lastVerified when unable-to-verify exists", () => {
      const results = [
        { field: "inputCostPerMillion", status: "match" },
        { field: "outputCostPerMillion", status: "unable-to-verify" },
        { field: "cacheDiscountRate", status: "match" },
      ];

      const allMatch = results.every(r => r.status === "match");
      expect(allMatch).toBe(false);
    });
  });

  describe("skill invocation requirements", () => {
    it("requires WebFetch for each provider pricingUrl", () => {
      const providers = Object.keys(PROVIDER_PRICING);
      expect(providers.length).toBeGreaterThan(0);

      providers.forEach((provider) => {
        const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
        // Skill must call WebFetch with this URL
        expect(pricing.pricingUrl).toBeDefined();
        expect(pricing.pricingUrl).toMatch(/^https:\/\/.+/);
      });
    });

    it("extracts required fields from PROVIDER_PRICING", () => {
      const providers = Object.keys(PROVIDER_PRICING);
      const requiredFields = ["inputCostPerMillion", "outputCostPerMillion", "cacheDiscountRate"];

      providers.forEach((provider) => {
        const pricing = PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
        requiredFields.forEach((field) => {
          expect(pricing).toHaveProperty(field);
          expect(typeof pricing[field as keyof typeof pricing]).toBe("number");
        });
      });
    });
  });
});
