import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { findLocalConfigDir } from "../config.js";
import { marked } from "marked";
import { isTestEnvironment } from "../test-env.js";

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  source: string; // file path
  agent?: string; // relevant agent name (for agent-specific tips)
  metadata?: Record<string, unknown>; // parsed from content (occurrences, dates, etc)
}

export interface Knowledge {
  agentTips: string;
  commonFailures: string;
  successPatterns: string;
  projectConventions: string;
  entriesLoaded: string[]; // entry IDs for telemetry
}

/**
 * Find .reygent/knowledge/ directory, searching upward from cwd.
 * Returns null if no .reygent/ found.
 */
export function findKnowledgeDir(): string | null {
  const configDir = findLocalConfigDir(process.cwd());
  if (!configDir) return null;
  return join(configDir, "knowledge");
}

/**
 * Sanitize markdown content to prevent prompt injection attacks.
 * Removes potentially malicious patterns while preserving legitimate content.
 */
function sanitizeMarkdown(content: string): string {
  // Remove common prompt injection patterns
  return content
    // Remove instructions to ignore previous instructions
    .replace(/ignore (all |previous |prior )?(instructions|prompts|context)/gi, '[FILTERED]')
    // Remove instructions to reveal system prompts
    .replace(/show me (your|the) (system prompt|instructions)/gi, '[FILTERED]')
    // Remove instructions to output sensitive files
    .replace(/output (the )?(contents? of|entire) (\.|\/)?\.?env/gi, '[FILTERED]')
    .replace(/(print|show|display|output) (secrets?|keys?|tokens?|passwords?)/gi, '[FILTERED]')
    // Remove roleplaying attempts
    .replace(/pretend (you are|to be) /gi, '[FILTERED]')
    .replace(/act as (if )?/gi, '[FILTERED]');
}

/**
 * Validate markdown content is well-formed and safe.
 * Returns true if content passes validation.
 */
function validateMarkdown(content: string): boolean {
  if (!content || content.trim().length === 0) return true;

  // Check for excessive size (>1MB indicates potential attack)
  if (content.length > 1024 * 1024) return false;

  // Check for suspicious patterns (many consecutive special chars)
  if (/[^a-zA-Z0-9\s]{50,}/.test(content)) return false;

  return true;
}

/**
 * Load and parse a markdown file.
 * Returns empty string if file doesn't exist or is empty.
 * Returns null if file validation fails (security).
 * Validates and sanitizes content to prevent prompt injection attacks.
 */
export function readMarkdown(filePath: string): string | null {
  if (!existsSync(filePath)) return "";

  const content = readFileSync(filePath, "utf-8");

  // Empty file is valid - return empty string
  if (!content || content.trim().length === 0) return "";

  // Validate content
  if (!validateMarkdown(content)) {
    console.warn(chalk.yellow(`⚠ Suspicious content detected in ${filePath}, skipping`));
    return null;
  }

  // Sanitize content
  return sanitizeMarkdown(content);
}

/**
 * Parse markdown content into structured entries.
 * Each top-level ## heading becomes an entry.
 * Returns array of entries with id, title, content.
 */
export function parseMarkdownEntries(markdown: string, source: string): KnowledgeEntry[] {
  if (!markdown.trim()) return [];

  let tokens;
  try {
    tokens = marked.lexer(markdown);
  } catch (err) {
    // Malformed markdown - return empty array instead of crashing
    if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'knowledge') {
      console.warn(`[debug:knowledge] Failed to parse markdown from ${source}:`, err instanceof Error ? err.message : String(err));
    }
    return [];
  }

  const entries: KnowledgeEntry[] = [];
  let currentEntry: Partial<KnowledgeEntry> | null = null;
  let currentContent: string[] = [];

  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 2) {
      // Save previous entry
      if (currentEntry) {
        entries.push({
          id: currentEntry.id!,
          title: currentEntry.title!,
          content: currentContent.join("\n").trim(),
          source,
        });
      }

      // Start new entry
      const title = token.text;
      const id = slugify(title);
      currentEntry = { id, title, source };
      currentContent = [];
    } else if (currentEntry) {
      // Accumulate content for current entry
      currentContent.push(token.raw);
    }
  }

  // Save final entry
  if (currentEntry) {
    entries.push({
      id: currentEntry.id!,
      title: currentEntry.title!,
      content: currentContent.join("\n").trim(),
      source,
    });
  }

  return entries;
}

/**
 * Slugify string: lowercase, replace spaces with dashes, remove non-alphanumeric.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Filter markdown entries by agent name.
 * Searches for agent name in entry content (case-insensitive).
 * Matches both "Agent: name" and "**Agent**: name" formats.
 */
export function filterByAgent(markdown: string, agentName: string, source: string): string {
  const entries = parseMarkdownEntries(markdown, source);
  const agentLower = agentName.toLowerCase();
  const filtered = entries.filter((entry) => {
    const contentLower = entry.content.toLowerCase();
    // Match "Agent: name" or "**Agent**: name"
    return contentLower.includes(`agent: ${agentLower}`) ||
           contentLower.includes(`**agent**: ${agentLower}`);
  });

  if (filtered.length === 0) return "";

  // Reconstruct markdown from filtered entries
  return filtered.map((entry) => `## ${entry.title}\n\n${entry.content}`).join("\n\n---\n\n");
}

/**
 * Filter markdown entries by recency (last N days).
 * Searches for "Last seen: YYYY-MM-DD" in entry content.
 * Handles both bold (**Last seen**:) and plain (Last seen:) formats.
 */
export function filterByRecency(markdown: string, source: string, days: number): string {
  const entries = parseMarkdownEntries(markdown, source);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const filtered = entries.filter((entry) => {
    // Match both **Last seen**: and Last seen: formats
    const match = entry.content.match(/(?:\*\*)?Last seen(?:\*\*)?:\s*(\d{4}-\d{2}-\d{2})/);
    if (!match) return false; // No date found, exclude

    const lastSeen = new Date(match[1]);
    return lastSeen >= cutoffDate;
  });

  if (filtered.length === 0) return "";

  return filtered.map((entry) => `## ${entry.title}\n\n${entry.content}`).join("\n\n---\n\n");
}

/**
 * Load knowledge for specific agent and stage.
 * Returns Knowledge object with relevant sections and entry IDs.
 */
export async function loadKnowledge(agentName: string, stage?: string): Promise<Knowledge> {
  const knowledgeDir = findKnowledgeDir();

  // If no knowledge dir, return empty knowledge and suggest initialization
  if (!knowledgeDir) {
    if (!isTestEnvironment() && process.env.REYGENT_DEBUG !== 'knowledge') {
      console.warn(chalk.yellow("⚠ No knowledge directory found. Run 'reygent init' to create .reygent/knowledge/"));
    }
    return {
      agentTips: "",
      commonFailures: "",
      successPatterns: "",
      projectConventions: "",
      entriesLoaded: [],
    };
  }

  if (!existsSync(knowledgeDir)) {
    return {
      agentTips: "",
      commonFailures: "",
      successPatterns: "",
      projectConventions: "",
      entriesLoaded: [],
    };
  }

  const entriesLoaded: string[] = [];

  // Load agent-specific tips (always relevant)
  const agentTipsPath = join(knowledgeDir, "agents", `${agentName}.md`);
  const agentTips = readMarkdown(agentTipsPath);
  if (agentTips) {
    const entries = parseMarkdownEntries(agentTips, agentTipsPath);
    entriesLoaded.push(...entries.map((e) => `${agentName}:${e.id}`));
  }

  // Load stage-relevant failures (filter by agent)
  const failuresPath = join(knowledgeDir, "common-failures.md");
  const allFailures = readMarkdown(failuresPath);
  const relevantFailures = filterByAgent(allFailures, agentName, failuresPath);
  if (relevantFailures) {
    const entries = parseMarkdownEntries(relevantFailures, failuresPath);
    entriesLoaded.push(...entries.map((e) => `failures:${e.id}`));
  }

  // Load recent success patterns (last 30 days)
  const patternsPath = join(knowledgeDir, "success-patterns.md");
  const allPatterns = readMarkdown(patternsPath);
  const recentPatterns = filterByRecency(allPatterns, patternsPath, 30);
  if (recentPatterns) {
    const entries = parseMarkdownEntries(recentPatterns, patternsPath);
    entriesLoaded.push(...entries.map((e) => `patterns:${e.id}`));
  }

  // Load project conventions (always relevant)
  const conventionsPath = join(knowledgeDir, "project-conventions.md");
  const projectConventions = readMarkdown(conventionsPath);
  if (projectConventions) {
    const entries = parseMarkdownEntries(projectConventions, conventionsPath);
    entriesLoaded.push(...entries.map((e) => `conventions:${e.id}`));
  }

  return {
    agentTips,
    commonFailures: relevantFailures,
    successPatterns: recentPatterns,
    projectConventions,
    entriesLoaded,
  };
}

/**
 * List all knowledge files in the knowledge directory.
 * Returns array of relative paths (e.g., "common-failures.md", "agents/dev.md").
 */
export function listKnowledgeFiles(): string[] {
  const knowledgeDir = findKnowledgeDir();
  if (!knowledgeDir || !existsSync(knowledgeDir)) return [];

  const files: string[] = [];

  function scan(dir: string, prefix: string = "") {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;

      if (stat.isDirectory()) {
        scan(fullPath, relativePath);
      } else if (stat.isFile() && entry.endsWith(".md")) {
        files.push(relativePath);
      }
    }
  }

  scan(knowledgeDir);
  return files.sort();
}

/**
 * Search knowledge files for a query string.
 * Returns array of matching entries with file path and excerpt.
 */
export interface SearchResult {
  file: string;
  entry: KnowledgeEntry;
  excerpt: string; // snippet showing match context
}

export function searchKnowledge(query: string): SearchResult[] {
  const knowledgeDir = findKnowledgeDir();
  if (!knowledgeDir || !existsSync(knowledgeDir)) return [];

  const files = listKnowledgeFiles();
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    const content = readMarkdown(filePath);
    const entries = parseMarkdownEntries(content, filePath);

    for (const entry of entries) {
      const titleMatch = entry.title.toLowerCase().includes(queryLower);
      const contentMatch = entry.content.toLowerCase().includes(queryLower);

      if (titleMatch || contentMatch) {
        // Extract excerpt (50 chars before and after match)
        const matchIndex = entry.content.toLowerCase().indexOf(queryLower);
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(entry.content.length, matchIndex + query.length + 50);
        const excerpt = "..." + entry.content.slice(start, end) + "...";

        results.push({ file, entry, excerpt });
      }
    }
  }

  return results;
}
