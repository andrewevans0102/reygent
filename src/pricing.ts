export type ProviderName = "claude" | "codex" | "openrouter" | "gemini";

export interface ProviderPricing {
  /** Cost per 1M input tokens (USD) */
  inputCostPerMillion: number;
  /** Cost per 1M output tokens (USD) */
  outputCostPerMillion: number;
  /** Fraction saved on cached tokens (0.90 = 90% savings) */
  cacheDiscountRate: number;
  /** Whether provider supports prompt caching */
  supportsCaching: boolean;
  /** Default model this pricing applies to */
  defaultModel: string;
  /** URL to provider's pricing page for verification */
  pricingUrl: string;
  /** Date this pricing was last verified (ISO format) */
  lastVerified: string;
}

export const PROVIDER_PRICING: Record<ProviderName, ProviderPricing> = {
  claude: {
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    cacheDiscountRate: 0.90,
    supportsCaching: true,
    defaultModel: "claude-sonnet-4-5-20250929",
    pricingUrl: "https://www.anthropic.com/pricing",
    lastVerified: "2026-05-15",
  },
  codex: {
    inputCostPerMillion: 2.50,
    outputCostPerMillion: 15.00,
    cacheDiscountRate: 0.90,
    supportsCaching: true,
    defaultModel: "gpt-5.4",
    pricingUrl: "https://openai.com/api/pricing/",
    lastVerified: "2026-05-15",
  },
  openrouter: {
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    cacheDiscountRate: 0.50,
    supportsCaching: true,
    defaultModel: "anthropic/claude-sonnet-4-5",
    pricingUrl: "https://openrouter.ai/models",
    lastVerified: "2026-05-15",
  },
  gemini: {
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10.00,
    cacheDiscountRate: 0.90,
    supportsCaching: true,
    defaultModel: "gemini-2.5-pro",
    pricingUrl: "https://ai.google.dev/pricing",
    lastVerified: "2026-05-15",
  },
};
