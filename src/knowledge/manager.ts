import { promises as fs } from 'fs';
import path from 'path';
import { AgentName } from '../agents.js';

export interface FailureEntryOptions {
  issue: string;
  solution: string;
  agent: AgentName;
  example?: string;
}

export interface PatternEntryOptions {
  description: string;
  approach?: string;
  successRate?: number;
}

/**
 * Check if path exists
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures the knowledge directory structure exists.
 * Creates .reygent/knowledge/ and subdirectories if missing.
 */
export async function ensureKnowledgeDir(baseDir: string): Promise<void> {
  const knowledgeDir = path.join(baseDir, '.reygent', 'knowledge');
  const agentsDir = path.join(knowledgeDir, 'agents');

  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.mkdir(agentsDir, { recursive: true });

  // Create initial template files if they don't exist
  const templates = [
    {
      file: path.join(knowledgeDir, 'common-failures.md'),
      content: `# Common Failures

This file documents recurring errors and their solutions.

---
`,
    },
    {
      file: path.join(knowledgeDir, 'success-patterns.md'),
      content: `# Success Patterns

This file captures proven approaches that work well.

---
`,
    },
    {
      file: path.join(knowledgeDir, 'project-conventions.md'),
      content: `# Project Conventions

Document project-specific rules, patterns, and conventions here.

Examples:
- Code style preferences
- Architecture decisions
- Naming conventions
- Testing strategies

---
`,
    },
    {
      file: path.join(agentsDir, 'dev.md'),
      content: `# Dev Agent Tips

## Common Failures

Document dev-specific errors here.

## Success Patterns

Document approaches that work well for development tasks.

---
`,
    },
    {
      file: path.join(agentsDir, 'qe.md'),
      content: `# QE Agent Tips

## Common Failures

Document QE-specific errors here.

## Success Patterns

Document testing approaches that work well.

---
`,
    },
    {
      file: path.join(agentsDir, 'planner.md'),
      content: `# Planner Agent Tips

## Common Failures

Document planning-specific errors here.

## Success Patterns

Document planning approaches that work well.

---
`,
    },
    {
      file: path.join(agentsDir, 'pr-reviewer.md'),
      content: `# PR Reviewer Agent Tips

## Common Failures

Document review-specific errors here.

## Success Patterns

Document review approaches that work well.

---
`,
    },
  ];

  for (const { file, content } of templates) {
    if (!(await pathExists(file))) {
      await fs.writeFile(file, content, 'utf8');
    }
  }
}

/**
 * Adds a failure entry to common-failures.md
 */
export async function addFailureEntry(
  baseDir: string,
  options: FailureEntryOptions
): Promise<void> {
  const filePath = path.join(baseDir, '.reygent', 'knowledge', 'common-failures.md');

  // Ensure file exists
  if (!(await pathExists(filePath))) {
    await ensureKnowledgeDir(baseDir);
  }

  const content = await fs.readFile(filePath, 'utf8');
  const timestamp = new Date().toISOString().split('T')[0];

  const entry = `
## ${options.issue}
**Occurrences**: 1 run
**Last seen**: ${timestamp}
**Agent**: ${options.agent}

**Solution**: ${options.solution}
${
  options.example
    ? `
**Example**:
\`\`\`
${options.example}
\`\`\`
`
    : ''
}
---
`;

  // Append to end of file
  await fs.writeFile(filePath, content + entry, 'utf8');
}

/**
 * Adds a success pattern entry to success-patterns.md
 */
export async function addPatternEntry(
  baseDir: string,
  options: PatternEntryOptions
): Promise<void> {
  const filePath = path.join(baseDir, '.reygent', 'knowledge', 'success-patterns.md');

  // Ensure file exists
  if (!(await pathExists(filePath))) {
    await ensureKnowledgeDir(baseDir);
  }

  const content = await fs.readFile(filePath, 'utf8');
  const timestamp = new Date().toISOString().split('T')[0];

  const entry = `
## ${options.description}
**Last seen**: ${timestamp}
${options.successRate ? `**Success rate**: ${options.successRate}%` : ''}

${
  options.approach
    ? `**Approach**:
${options.approach}
`
    : ''
}
---
`;

  // Append to end of file
  await fs.writeFile(filePath, content + entry, 'utf8');
}
