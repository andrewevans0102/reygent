/**
 * Utilities for splitting large git diffs into manageable chunks for review.
 */

import chalk from "chalk";
import type { PRReviewComment, PRReviewOutput } from "./task.js";

/**
 * Rough token estimate: ~1 token per 4 characters.
 * Conservative estimate used for context window safety.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Maximum diff size in estimated tokens before splitting.
 * Set conservatively to avoid context window issues across providers.
 * - Claude Sonnet 4.5: 200k context
 * - GPT-5.4: 128k context
 * - Gemini 2.0: varies by model
 * Use 80k as safe threshold (leaves room for system prompt, spec, etc.)
 */
export const MAX_DIFF_TOKENS = 80_000;

/**
 * Parse a unified diff into per-file chunks.
 * Each chunk includes the file header and all hunks for that file.
 */
export interface FileDiff {
  /** File path (from diff header) */
  file: string;
  /** Full diff content for this file */
  diff: string;
}

/**
 * Split a unified diff by file.
 * Returns array of file diffs, preserving original diff format.
 */
export function splitDiffByFile(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diff.split("\n");

  let currentFile: string | null = null;
  let currentDiff: string[] = [];

  for (const line of lines) {
    // Detect file header: "diff --git a/path b/path"
    if (line.startsWith("diff --git ")) {
      // Save previous file if exists
      if (currentFile && currentDiff.length > 0) {
        files.push({ file: currentFile, diff: currentDiff.join("\n") });
      }

      // Extract file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      currentFile = match ? match[2] : "unknown";
      currentDiff = [line];
    } else if (currentFile) {
      // Accumulate lines for current file
      currentDiff.push(line);
    }
  }

  // Save final file
  if (currentFile && currentDiff.length > 0) {
    files.push({ file: currentFile, diff: currentDiff.join("\n") });
  }

  return files;
}

/**
 * Merge multiple PR review outputs into a single combined result.
 * Combines summaries, deduplicates comments, and merges recommended actions.
 */
export function mergePRReviews(reviews: PRReviewOutput[]): PRReviewOutput {
  if (reviews.length === 0) {
    return {
      summary: "No reviews to merge",
      comments: [],
      recommendedActions: [],
    };
  }

  if (reviews.length === 1) {
    return reviews[0];
  }

  // Combine summaries
  const summaries = reviews
    .map((r, i) => `**File set ${i + 1}:** ${r.summary}`)
    .join("\n\n");
  const summary = `Combined review of ${reviews.length} file sets:\n\n${summaries}`;

  // Merge all comments (no dedup needed - different files/lines)
  const comments: PRReviewComment[] = reviews.flatMap((r) => r.comments);

  // Merge and deduplicate recommended actions
  const actionSet = new Set<string>();
  for (const review of reviews) {
    for (const action of review.recommendedActions) {
      actionSet.add(action);
    }
  }
  const recommendedActions = Array.from(actionSet);

  return { summary, comments, recommendedActions };
}

/**
 * Format file list for display, truncating if too many files.
 */
export function formatFileList(files: string[], maxDisplay = 10): string {
  if (files.length <= maxDisplay) {
    return files.map((f) => `  - ${f}`).join("\n");
  }

  const shown = files.slice(0, maxDisplay);
  const remaining = files.length - maxDisplay;
  return (
    shown.map((f) => `  - ${f}`).join("\n") +
    `\n  ${chalk.gray(`... and ${remaining} more files`)}`
  );
}

/**
 * Estimate API cost increase for file-by-file review vs single review.
 * File-by-file has more overhead (system prompt repeated N times).
 */
export function estimateCostMultiplier(fileCount: number): number {
  // Single review: 1x cost
  // File-by-file: ~1.2-1.5x cost due to prompt repetition
  // Conservative estimate: 1.5x
  return Math.max(1.0, fileCount * 0.5);
}
