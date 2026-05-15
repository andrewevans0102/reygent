/**
 * Utilities for splitting unified diffs by file and selecting
 * per-file diffs within a token budget.
 */

export interface FileDiff {
  /** File path from the diff header (prefers b/ path) */
  file: string;
  /** Full unified diff text for this file, including header */
  diff: string;
  /** Estimated token count */
  tokens: number;
}

/**
 * Approximate tokens — ~4 chars per token.
 *
 * This is a rough average that works across most content types but can vary
 * significantly depending on the text characteristics:
 * - Code with many identifiers/keywords may be closer to 3 chars/token
 * - Prose or repetitive patterns may be closer to 5 chars/token
 * - This estimation is intentionally conservative for budget calculations
 *
 * If budget decisions consistently exclude too many or too few files,
 * tune this ratio based on telemetry feedback and actual provider tokenization.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Safe context budget across all providers (80k tokens).
 *
 * This conservative limit ensures reviews work reliably across all supported
 * providers while leaving headroom for:
 * - Prompt instructions and templates (~2-3k tokens)
 * - Review comment formatting and metadata (~1-2k tokens)
 * - Provider response generation (reviews can be lengthy)
 *
 * Provider-specific context windows:
 * - Claude Opus 4.6: 200k tokens
 * - Claude Sonnet 3.5: 200k tokens
 * - Gemini 2.0 Flash: 1M tokens
 * - GPT-4 Turbo: 128k tokens
 *
 * The 80k limit is set well below the smallest provider window (GPT-4 Turbo)
 * to ensure consistent behavior. For very large PRs (100+ files, 10k+ lines),
 * consider splitting into multiple focused reviews or increasing this constant
 * after validating against real-world telemetry data.
 */
export const MAX_REVIEW_TOKENS = 80_000;

/**
 * Reserved token overhead for prompt templates and formatting.
 *
 * This accounts for:
 * - Review prompt instructions and structure (~1k tokens)
 * - Comment formatting and metadata (~500-1k tokens)
 * - Headroom for prompt template expansion (~500 tokens)
 *
 * If prompt templates grow significantly, increase this value or calculate
 * dynamically from actual prompt size.
 */
export const RESERVED_PROMPT_TOKENS = 2_000;

/**
 * Split a unified diff into per-file chunks.
 * Each chunk starts with `diff --git` and includes everything
 * up to (but not including) the next `diff --git`.
 */
export function splitDiffByFile(rawDiff: string): FileDiff[] {
  if (!rawDiff.trim()) return [];

  const files: FileDiff[] = [];
  // Split on diff headers, keeping the delimiter
  const parts = rawDiff.split(/^(?=diff --git )/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.startsWith("diff --git ")) continue;

    // Extract file path from "diff --git a/path b/path"
    const headerMatch = trimmed.match(/^diff --git a\/(.+?) b\/(.+)/m);
    const file = headerMatch ? headerMatch[2] : "unknown";

    files.push({
      file,
      diff: trimmed,
      tokens: estimateTokens(trimmed),
    });
  }

  return files;
}

/**
 * Generated/lock files that provide no useful review context and confuse
 * LLM agents (agents try to stat paths found in lock file JSON).
 * These are always excluded from diff budget selection.
 */
const EXCLUDED_DIFF_PATTERNS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Gemfile.lock",
  "Pipfile.lock",
  "poetry.lock",
  "composer.lock",
  "Cargo.lock",
];

function isExcludedFile(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? filePath;
  return EXCLUDED_DIFF_PATTERNS.includes(basename);
}

/**
 * Greedily select file diffs that fit within a token budget.
 * Returns included diffs and names of excluded files.
 * Lock/generated files are always excluded.
 */
export function selectDiffsWithinBudget(
  files: FileDiff[],
  budgetTokens: number,
  reservedTokens: number,
): { included: FileDiff[]; excluded: string[] } {
  const available = budgetTokens - reservedTokens;
  const included: FileDiff[] = [];
  const excluded: string[] = [];
  let used = 0;

  for (const f of files) {
    if (isExcludedFile(f.file)) {
      excluded.push(f.file);
      continue;
    }
    if (used + f.tokens <= available) {
      included.push(f);
      used += f.tokens;
    } else {
      excluded.push(f.file);
    }
  }

  return { included, excluded };
}
