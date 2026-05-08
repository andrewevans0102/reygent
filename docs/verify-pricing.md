# Verify Pricing

Reygent tracks per-provider token pricing in `src/pricing.ts` to estimate workflow costs. The **verify-pricing** skill checks these values against live provider documentation and keeps them up to date.

## Running the Skill

In a Claude Code session inside the reygent repo:

```
/verify-pricing
```

No CLI command or build step required — this is a Claude Code skill, not a reygent command.

## What It Does

1. **Reads** the `PROVIDER_PRICING` object in `src/pricing.ts`
2. **Fetches** each provider's pricing page (stored in `pricingUrl`)
3. **Compares** three fields per provider:
   - `inputCostPerMillion` — cost per 1M input tokens (USD)
   - `outputCostPerMillion` — cost per 1M output tokens (USD)
   - `cacheDiscountRate` — fraction saved on cached tokens (0–1 scale)
4. **Reports** a comparison table with match/mismatch/unable-to-verify status
5. **Applies** updates:
   - All fields match → auto-updates `lastVerified` to today
   - Mismatches found → lists suggested changes, waits for confirmation before editing
   - Unable to verify → field skipped, no changes applied

## Pricing Data Structure

Each provider entry in `src/pricing.ts` looks like this:

```typescript
claude: {
  inputCostPerMillion: 3.00,
  outputCostPerMillion: 15.00,
  cacheDiscountRate: 0.90,
  supportsCaching: true,
  defaultModel: "claude-sonnet-4-5-20250929",
  pricingUrl: "https://www.anthropic.com/pricing",
  lastVerified: "2026-05-08",
},
```

| Field | Type | Description |
|-------|------|-------------|
| `inputCostPerMillion` | number | USD per 1M input tokens |
| `outputCostPerMillion` | number | USD per 1M output tokens |
| `cacheDiscountRate` | number | Fraction saved on cached tokens (0.90 = 90% savings, pay 10%) |
| `supportsCaching` | boolean | Whether provider supports prompt caching |
| `defaultModel` | string | Model these prices apply to |
| `pricingUrl` | string | URL fetched during verification |
| `lastVerified` | string | ISO date of last successful verification |

## Example Output

```
Provider     Field                 Current    Actual     Status
──────────────────────────────────────────────────────────────────────
claude       inputCostPerMillion   $3.00/M    $3.00/M    ✓ match
claude       outputCostPerMillion  $15.00/M   $15.00/M   ✓ match
claude       cacheDiscountRate     90%        90%        ✓ match
claude       lastVerified          2025-05-04            → updating to 2026-05-08

codex        inputCostPerMillion   $2.50/M    $1.25/M    ✗ MISMATCH
codex        outputCostPerMillion  $10.00/M   $10.00/M   ✓ match
codex        cacheDiscountRate     75%        90%        ✗ MISMATCH

openrouter   inputCostPerMillion   $3.00/M    $3.00/M    ✓ match
openrouter   outputCostPerMillion  $15.00/M   $15.00/M   ✓ match
openrouter   cacheDiscountRate     50%                   ? unable to verify
──────────────────────────────────────────────────────────────────────
2 mismatches found in codex provider.

Suggested changes to src/pricing.ts:

  codex.inputCostPerMillion: 2.50 → 1.25
  codex.cacheDiscountRate: 0.75 → 0.90
  codex.lastVerified: "2025-05-04" → "2026-05-08"

Apply these changes? (y/n)
```

## Cache Discount Rate Normalization

Provider docs express caching savings in different formats. The skill normalizes all of them to a 0–1 decimal representing the fraction saved:

| Doc Format | Meaning | Normalized Rate |
|------------|---------|-----------------|
| "90% savings" | Save 90% of cost | 0.90 |
| "billed at 10%" | Pay 10%, save 90% | 0.90 |
| "0.1x base input price" | Pay 10% of base | 0.90 |
| "$0.30 vs $3.00" | Price comparison | 0.90 |

When a provider's caching documentation is ambiguous or missing, the field is marked `? unable to verify` rather than guessed.

## Update Rules

- **Auto-update**: `lastVerified` date updates automatically when all verified fields match
- **Manual approval**: Pricing value changes require user confirmation before applying
- **Partial verification**: If any field can't be verified, `lastVerified` is not auto-updated for that provider
- **No guessing**: Fields that can't be extracted from provider docs are skipped, never estimated

## Adding a New Provider

To add a provider to pricing verification:

1. Add an entry to `PROVIDER_PRICING` in `src/pricing.ts` with all required fields
2. Add the provider name to the `ProviderName` type union
3. Set `pricingUrl` to a page where token pricing is publicly listed
4. Run `/verify-pricing` to validate the initial values
