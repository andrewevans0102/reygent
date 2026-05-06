import type { SpecPayload } from "./spec.js";

/**
 * Valid conventional commit type prefixes for branch names
 */
export const VALID_BRANCH_TYPES = [
  "feat",
  "fix",
  "chore",
  "refactor",
  "docs",
  "test",
  "style",
  "perf",
] as const;

export type BranchType = typeof VALID_BRANCH_TYPES[number];

/**
 * Long-form aliases that normalize to short conventional types
 */
const TYPE_ALIASES: Record<string, BranchType> = {
  feature: "feat",
  bugfix: "fix",
};

/**
 * Normalize type input to canonical conventional commit prefix
 * @throws Error if type is invalid
 */
export function normalizeType(type: string): BranchType {
  const lower = type.toLowerCase().trim();

  // Check if it's a long-form alias
  if (lower in TYPE_ALIASES) {
    return TYPE_ALIASES[lower];
  }

  // Check if it's already a valid type
  if (VALID_BRANCH_TYPES.includes(lower as BranchType)) {
    return lower as BranchType;
  }

  throw new Error(
    `Invalid branch type: ${type}. Valid types: ${VALID_BRANCH_TYPES.join(", ")}, feature, bugfix`
  );
}

/**
 * Check if a type string is valid (without throwing)
 */
export function isValidType(type: string): boolean {
  try {
    normalizeType(type);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect branch type from Jira issue type field
 * Uses partial matching (e.g., "Bug Fix" matches "bug")
 * Returns null if type cannot be mapped
 */
export function detectTypeFromJiraIssueType(issueType: string): BranchType | null {
  const lower = issueType.toLowerCase();

  if (lower.includes("bug") || lower.includes("fix")) return "fix";
  if (lower.includes("story") || lower.includes("feature") || lower.includes("enhancement")) return "feat";
  if (lower.includes("task") || lower.includes("chore")) return "chore";
  if (lower.includes("refactor") || lower.includes("technical debt")) return "refactor";
  if (lower.includes("doc")) return "docs";
  if (lower.includes("test")) return "test";
  if (lower.includes("style")) return "style";
  if (lower.includes("perf") || lower.includes("performance")) return "perf";

  return null;
}

/**
 * Detect branch type from Linear issue labels
 * Returns null if no matching label found
 * Priority order: bug > feature > others
 */
export function detectTypeFromLinearLabels(labels: string[]): BranchType | null {
  const lower = labels.map(l => l.toLowerCase());

  // Priority order: bug > feature > others
  if (lower.some(l => l.includes("bug"))) return "fix";
  if (lower.some(l => l.includes("feature"))) return "feat";
  if (lower.some(l => l.includes("chore") || l.includes("maintenance"))) return "chore";
  if (lower.some(l => l.includes("refactor") || l.includes("tech-debt"))) return "refactor";
  if (lower.some(l => l.includes("doc"))) return "docs";

  return null;
}

/**
 * Derive branch name with type prefix from spec payload
 * @param spec - Spec payload from jira, linear, or markdown
 * @param type - Branch type prefix
 * @returns Full branch name like "feat/PROJ-123" or "fix/add-user-auth"
 */
export function deriveBranchNameWithType(spec: SpecPayload, type: BranchType): string {
  const prefix = type;

  if (spec.source === "jira") {
    return `${prefix}/${spec.issueKey}`;
  }

  if (spec.source === "linear") {
    return `${prefix}/${spec.issueId}`;
  }

  // Markdown source - slugify title
  const slug = spec.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `${prefix}/${slug}`;
}

/**
 * Derive branch name from spec with type detection
 * Tries auto-detection from issueType/labels, falls back to typeOverride
 * @throws Error if no type can be determined
 */
export function deriveBranchFromSpec(
  spec: SpecPayload,
  typeOverride?: string,
): string {
  let type: BranchType | null = null;

  // CLI flag takes priority
  if (typeOverride) {
    type = normalizeType(typeOverride);
  } else {
    // Try auto-detection
    if (spec.source === "jira" && spec.issueType) {
      type = detectTypeFromJiraIssueType(spec.issueType);
    } else if (spec.source === "linear" && "labels" in spec && spec.labels) {
      type = detectTypeFromLinearLabels(spec.labels);
    }
  }

  if (!type) {
    throw new Error("Branch type is required");
  }

  return deriveBranchNameWithType(spec, type);
}

/**
 * Prompt user for branch type interactively
 * @param promptFn - Prompt function from @inquirer/prompts
 * @param detectedType - Optional auto-detected type to use as default
 * @param opts - Options including skipPrompt flag
 * @returns Normalized branch type
 */
export async function promptForType(
  promptFn: (config: {
    message: string;
    choices: { name: string; value: string }[];
    default?: string
  }) => Promise<string | null | undefined>,
  detectedType: BranchType | null,
  opts: { skipPrompt?: boolean } = {},
): Promise<BranchType> {
  if (opts.skipPrompt) {
    if (!detectedType) {
      throw new Error("Branch type is required");
    }
    return detectedType;
  }

  const choices = VALID_BRANCH_TYPES.map(t => ({ name: t, value: t }));
  const config = {
    message: "Select branch type:",
    choices,
    default: detectedType ?? undefined,
  };

  const response = await promptFn(config);

  if (response === null) {
    throw new Error("Branch creation cancelled");
  }

  if (response === undefined || !response.trim()) {
    throw new Error("Branch type is required");
  }

  return normalizeType(response.trim());
}
