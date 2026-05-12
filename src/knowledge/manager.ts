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
 * Parse markdown to extract entries with metadata
 */
interface ParsedEntry {
  title: string;
  occurrences?: number;
  lastSeen: string;
  agent?: string;
  successRate?: number;
  fullContent: string;
}

function parseEntries(markdown: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const sections = markdown.split(/^## /m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0]?.trim() || 'Untitled';

    const occurrenceMatch = section.match(/\*\*Occurrences\*\*:\s*(\d+)/);
    const lastSeenMatch = section.match(/\*\*Last seen\*\*:\s*(\d{4}-\d{2}-\d{2})/);
    const agentMatch = section.match(/\*\*Agent\*\*:\s*(\w+)/);
    const successRateMatch = section.match(/\*\*Success rate\*\*:\s*(\d+)%/);

    // Validate date format - use default if invalid
    let lastSeen = new Date().toISOString().split('T')[0];
    if (lastSeenMatch) {
      const parsedDate = new Date(lastSeenMatch[1]);
      if (!isNaN(parsedDate.getTime())) {
        lastSeen = lastSeenMatch[1];
      }
    }

    entries.push({
      title,
      occurrences: occurrenceMatch ? parseInt(occurrenceMatch[1], 10) : undefined,
      lastSeen,
      agent: agentMatch ? agentMatch[1] : undefined,
      successRate: successRateMatch ? parseInt(successRateMatch[1], 10) : undefined,
      fullContent: '## ' + section,
    });
  }

  return entries;
}

/**
 * Prune old entries that haven't been seen in days
 */
function pruneOldEntries(entries: ParsedEntry[], maxAgeDays: number): ParsedEntry[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  return entries.filter(entry => entry.lastSeen >= cutoffStr);
}

/**
 * Limit entries to max count, keeping most recent
 */
function limitEntries(entries: ParsedEntry[], maxEntries: number): ParsedEntry[] {
  return entries
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, maxEntries);
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
 * Adds a failure entry to common-failures.md.
 * Updates existing entry if duplicate found, otherwise adds new.
 * Prunes entries older than 90 days and limits to 50 entries.
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

  // Parse existing entries
  const entries = parseEntries(content);

  // Check for duplicate (same title and agent)
  const existingIndex = entries.findIndex(
    e => e.title === options.issue && e.agent === options.agent
  );

  if (existingIndex !== -1) {
    // Update existing entry
    const existing = entries[existingIndex];
    const newOccurrences = (existing.occurrences || 1) + 1;

    entries[existingIndex].fullContent = `
## ${options.issue}
**Occurrences**: ${newOccurrences} runs
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
    entries[existingIndex].lastSeen = timestamp;
    entries[existingIndex].occurrences = newOccurrences;
  } else {
    // Add new entry
    entries.push({
      title: options.issue,
      occurrences: 1,
      lastSeen: timestamp,
      agent: options.agent,
      fullContent: `
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
`,
    });
  }

  // Prune old entries (90 days) and limit to 50
  let managedEntries = pruneOldEntries(entries, 90);
  managedEntries = limitEntries(managedEntries, 50);

  // Rebuild file
  const header = '# Common Failures\n\nThis file documents recurring errors and their solutions.\n\n---\n';
  const newContent = header + managedEntries.map(e => e.fullContent).join('\n');

  await fs.writeFile(filePath, newContent, 'utf8');
}

/**
 * Adds a success pattern entry to success-patterns.md.
 * Updates existing entry if duplicate found, otherwise adds new.
 * Prunes entries older than 60 days and limits to 30 entries.
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

  // Parse existing entries
  const entries = parseEntries(content);

  // Check for duplicate (same title)
  const existingIndex = entries.findIndex(e => e.title === options.description);

  if (existingIndex !== -1) {
    // Update existing entry
    entries[existingIndex].fullContent = `
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
    entries[existingIndex].lastSeen = timestamp;
    if (options.successRate) {
      entries[existingIndex].successRate = options.successRate;
    }
  } else {
    // Add new entry
    entries.push({
      title: options.description,
      lastSeen: timestamp,
      successRate: options.successRate,
      fullContent: `
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
`,
    });
  }

  // Prune old entries (60 days) and limit to 30
  let managedEntries = pruneOldEntries(entries, 60);
  managedEntries = limitEntries(managedEntries, 30);

  // Rebuild file
  const header = '# Success Patterns\n\nThis file captures proven approaches that work well.\n\n---\n';
  const newContent = header + managedEntries.map(e => e.fullContent).join('\n');

  await fs.writeFile(filePath, newContent, 'utf8');
}
