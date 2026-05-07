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
claude       lastVerified         2025-05-04                  → updating to 2026-05-07

codex        inputCostPerMillion  $2.50/M       $3.00/M       ✗ MISMATCH
codex        outputCostPerMillion $10.00/M      ? unable to verify
codex        cacheDiscountRate    75%           50%           ✗ MISMATCH

openrouter   inputCostPerMillion  $3.00/M       ? unable to verify
openrouter   cacheDiscountRate    50%           ? unable to verify

gemini       inputCostPerMillion  $1.25/M       $1.25/M       ✓ match
gemini       outputCostPerMillion $5.00/M       $5.00/M       ✓ match
gemini       cacheDiscountRate    50%           ? unable to verify
gemini       lastVerified         2025-05-04                  → updating to 2026-05-07

──────────────────────────────────────────────────────────────────────
2 mismatches found in codex provider.

Suggested changes to src/pricing.ts:

  codex.inputCostPerMillion: 2.50 → 3.00
  codex.cacheDiscountRate: 0.75 → 0.50
  codex.lastVerified: "2025-05-04" → "2026-05-07"

Apply these changes? (y/n)
```

If user approves, apply changes to `src/pricing.ts`.

## Notes

- Cache discount rates may be stated as percentages (e.g., "90% savings") or multipliers (e.g., "billed at 10%")
  - "90% savings" = 0.90 discount rate
  - "billed at 10%" = 0.90 discount rate
- OpenRouter pricing varies by model — verify against the `defaultModel` value in the config
- Some providers may not clearly document cache discount rates — mark as "unable to verify" rather than guessing
- Always update `lastVerified` date when making pricing changes
- Only auto-update `lastVerified` when ALL checked fields match (don't update partially verified providers)
- DO NOT apply changes without user confirmation when mismatches are found
- When all values match, auto-update `lastVerified` dates without prompting
