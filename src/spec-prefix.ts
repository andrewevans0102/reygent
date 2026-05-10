import { SpecProvider } from "./spec.js";

export class SpecPrefixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecPrefixError";
  }
}

export interface ParsedSpecSource {
  provider: SpecProvider;
  identifier: string;
}

export const VALID_PREFIXES = ["jira:", "linear:", "markdown:"] as const;

/**
 * Parse spec source with required provider prefix.
 * Format: <provider>:<source>
 *
 * Examples:
 *   jira:ENG-123
 *   linear:DT-275
 *   markdown:./test-spec.md
 *
 * Auto-infers markdown: for file paths ending in .md or starting with ./ or /
 */
export function parseSpecWithPrefix(input: string): ParsedSpecSource {
  // Check for explicit prefix first
  const colonIndex = input.indexOf(":");
  if (colonIndex !== -1) {
    const prefix = input.substring(0, colonIndex + 1);
    const identifier = input.substring(colonIndex + 1);

    if (!identifier.trim()) {
      throw new SpecPrefixError(`Empty source after "${prefix}" prefix`);
    }

    switch (prefix) {
      case "jira:":
        return { provider: "jira", identifier };
      case "linear:":
        return { provider: "linear", identifier };
      case "markdown:":
        return { provider: "local", identifier };
      default:
        throw new SpecPrefixError(
          `Invalid prefix "${prefix}". Must be one of: ${VALID_PREFIXES.join(", ")}`
        );
    }
  }

  // Auto-infer markdown: prefix for file paths
  if (isFilePath(input)) {
    return { provider: "local", identifier: input };
  }

  // No prefix and not a file path
  throw new SpecPrefixError(
    `Source prefix required. Valid formats:\n` +
    `  jira:PROJ-123\n` +
    `  linear:DT-275\n` +
    `  markdown:./spec.md\n` +
    `Or use file path (ends in .md or starts with ./ or /)`
  );
}

/**
 * Check if input looks like a file path.
 * Returns true for:
 *   - Paths ending in .md or .markdown (case insensitive)
 *   - Paths starting with ./ or /
 */
function isFilePath(input: string): boolean {
  if (/\.(md|markdown)$/i.test(input)) return true;
  if (input.startsWith("./") || input.startsWith("/")) return true;
  return false;
}
