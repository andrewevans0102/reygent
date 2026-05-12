import { existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';

/**
 * Project markers that indicate a project root directory.
 * Checked in order of specificity.
 */
const PROJECT_MARKERS = [
  '.reygent',      // Reygent already initialized
  '.git',          // Git repository
  'package.json',  // Node.js project
  'pyproject.toml', // Python project
  'Cargo.toml',    // Rust project
  'go.mod',        // Go project
  'Gemfile',       // Ruby project
  'composer.json', // PHP project
  'pom.xml',       // Java/Maven project
  'build.gradle',  // Java/Gradle project
];

/**
 * Max number of directories to traverse upward (security limit)
 */
const MAX_TRAVERSAL_DEPTH = 10;

/**
 * Search upward from startDir to find project root.
 * Returns project root directory if found, null otherwise.
 *
 * Searches for common project markers (.git, package.json, etc.)
 * starting from startDir and walking up the directory tree.
 * Limited to MAX_TRAVERSAL_DEPTH levels to prevent excessive filesystem traversal.
 */
export function findProjectRoot(startDir: string): string | null {
  let currentDir = startDir;
  const root = parse(currentDir).root;
  let depth = 0;

  while (currentDir !== root && depth < MAX_TRAVERSAL_DEPTH) {
    // Check if any project marker exists in current directory
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(currentDir, marker))) {
        return currentDir;
      }
    }

    // Move up one directory
    currentDir = dirname(currentDir);
    depth++;
  }

  // Hit traversal limit - log for debugging
  if (depth >= MAX_TRAVERSAL_DEPTH && (process.env.REYGENT_DEBUG === '1')) {
    console.error(`[debug] findProjectRoot: MAX_TRAVERSAL_DEPTH (${MAX_TRAVERSAL_DEPTH}) reached from ${startDir}`);
  }

  return null;
}

/**
 * Check if currently in a project (has project root).
 */
export function isInProject(startDir: string = process.cwd()): boolean {
  return findProjectRoot(startDir) !== null;
}
