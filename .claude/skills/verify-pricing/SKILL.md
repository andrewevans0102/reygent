---
description: Verify provider pricing accuracy against current documentation
user_invocable: true
---

# verify-pricing

Verify that provider pricing data in `src/pricing.ts` matches current values from provider documentation.

## Steps

1. Read `src/pricing.ts` to extract current pricing data and provider URLs
2. For each provider in PROVIDER_PRICING:
   - Use WebFetch to fetch the pricing page at `pricingUrl`
   - Extract current pricing information:
     - Input token cost per million
     - Output token cost per million (when available)
     - Cache discount rate (when caching is supported)
   - Compare extracted values against `src/pricing.ts`
3. Generate comparison table showing:
   - Provider name
   - Field name (inputCostPerMillion, outputCostPerMillion, cacheDiscountRate)
   - Current value (from src/pricing.ts)
   - Actual value (from provider docs)
   - Status: ✓ match, ✗ mismatch, ? unable to verify
4. If mismatches found:
   - List specific suggested changes to `src/pricing.ts`
   - Show exact before/after values
   - Include `lastVerified` date update to today
5. If all values match or only verification failures (no mismatches):
   - Update `lastVerified` field for successfully verified providers to today's date
   - Apply the changes to `src/pricing.ts`

## Output format

```
Verifying provider pricing...

Provider     Field                Current       Actual        Status
──────────────────────────────────────────────────────────────────────
claude       inputCostPerMillion  $3.00/M       $3.00/M       ✓ match
claude       outputCostPerMillion $15.00/M      $15.00/M      ✓ match
claude       cacheDiscountRate    90%           90%           ✓ match
claude       lastVerified         2026-05-15                  ✓ verified

codex        inputCostPerMillion  $2.50/M       $2.50/M       ✓ match
codex        outputCostPerMillion $15.00/M      $15.00/M      ✓ match
codex        cacheDiscountRate    90%           90%           ✓ match
codex        lastVerified         2026-05-15                  ✓ verified

openrouter   inputCostPerMillion  $3.00/M       $3.00/M       ✓ match
openrouter   cacheDiscountRate    50%           ? unable to verify
openrouter   lastVerified         2025-05-04                  → updating to 2026-05-15

gemini       inputCostPerMillion  $1.25/M       $1.25/M       ✓ match
gemini       outputCostPerMillion $10.00/M      $10.00/M      ✓ match
gemini       cacheDiscountRate    90%           90%           ✓ match
gemini       lastVerified         2026-05-15                  ✓ verified

──────────────────────────────────────────────────────────────────────
All verified pricing matches current provider documentation.
Updating lastVerified dates for successfully verified providers.
```

If user approves, apply changes to `src/pricing.ts`.

## Implementation: Updating src/pricing.ts

When all values match for a provider, update the `lastVerified` date automatically using the Edit tool:

```typescript
// Example: Update claude provider's lastVerified date
Edit({
  file_path: "/path/to/src/pricing.ts",
  old_string: `  claude: {
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    cacheDiscountRate: 0.90,
    supportsCaching: true,
    defaultModel: "claude-sonnet-4-5-20250929",
    pricingUrl: "https://www.anthropic.com/pricing",
    lastVerified: "2025-05-04",
  },`,
  new_string: `  claude: {
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    cacheDiscountRate: 0.90,
    supportsCaching: true,
    defaultModel: "claude-sonnet-4-5-20250929",
    pricingUrl: "https://www.anthropic.com/pricing",
    lastVerified: "2026-05-07",
  },`
});
```

When mismatches exist, use Edit to apply the full pricing block after user approval:

```typescript
// Example: Update codex provider with corrected pricing
Edit({
  file_path: "/path/to/src/pricing.ts",
  old_string: `  codex: {
    inputCostPerMillion: 2.50,
    outputCostPerMillion: 10.00,
    cacheDiscountRate: 0.75,
    supportsCaching: true,
    defaultModel: "codex",
    pricingUrl: "https://openai.com/api/pricing/",
    lastVerified: "2025-05-04",
  },`,
  new_string: `  codex: {
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 10.00,
    cacheDiscountRate: 0.50,
    supportsCaching: true,
    defaultModel: "codex",
    pricingUrl: "https://openai.com/api/pricing/",
    lastVerified: "2026-05-07",
  },`
});
```

## Notes

### Parsing cache discount rates

Cache discount rates appear in varying formats across provider documentation. Extract and normalize to decimal rate (0-1 range):

| Format Example | Meaning | Normalized Rate | Notes |
|----------------|---------|-----------------|-------|
| "90% savings" | 90% of cost is saved | 0.90 | Direct percentage → divide by 100 |
| "billed at 10%" | Pay 10%, save 90% | 0.90 | savings = 1 - (billed%) |
| "0.90x cost" | Pay 90%, save 10% | 0.10 | savings = 1 - multiplier |
| "10% of full price" | Pay 10%, save 90% | 0.90 | savings = 1 - (percentage/100) |
| "$0.30 vs $3.00" | Ratio-based | 0.90 | savings = (full - discounted) / full |

**Extraction logic:**
- Look for keywords: "savings", "discount", "reduction", "cached", "cache"
- Percentage patterns: `(\d+(?:\.\d+)?)%`
- Multiplier patterns: `(\d+(?:\.\d+)?)x`
- Price comparison: extract both values, calculate `(full - cached) / full`
- Always verify normalized rate is in range [0, 1]
- OpenRouter pricing varies by model — verify against the `defaultModel` value in the config
- Some providers may not clearly document cache discount rates — mark as "unable to verify" rather than guessing
- Always update `lastVerified` date when making pricing changes
- Only auto-update `lastVerified` when ALL checked fields match (don't update partially verified providers)
- DO NOT apply changes without user confirmation when mismatches are found
- When all values match, auto-update `lastVerified` dates without prompting
