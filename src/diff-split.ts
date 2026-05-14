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

/** Approximate tokens — ~4 chars per token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Safe context budget across all providers */
export const MAX_REVIEW_TOKENS = 80_000;

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
 * Greedily select file diffs that fit within a token budget.
 * Returns included diffs and names of excluded files.
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
    if (used + f.tokens <= available) {
      included.push(f);
      used += f.tokens;
    } else {
      excluded.push(f.file);
    }
  }

  return { included, excluded };
}
