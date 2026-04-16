import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import chalk from "chalk";
import { isLinearUrl, extractLinearId, readLinearSpec } from "./linear.js";
import { readJiraSpec } from "./jira.js";
import { loadEnvFile } from "./env.js";

export interface MarkdownSpecPayload {
  source: "markdown";
  content: string;
  title: string;
}

export interface JiraSpecPayload {
  source: "jira";
  issueKey: string;
  content: string;
  title: string;
}

export interface LinearSpecPayload {
  source: "linear";
  issueId: string;
  content: string;
  title: string;
}

export type SpecPayload = MarkdownSpecPayload | JiraSpecPayload | LinearSpecPayload;

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

export function readSpec(filePath: string): MarkdownSpecPayload {
  const resolved = resolve(process.cwd(), filePath);

  if (!existsSync(resolved)) {
    throw new SpecError(`File not found: ${resolved}`);
  }

  const ext = extname(resolved).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    console.log(chalk.yellow("Warning:"), `${basename(resolved)} is not a .md file`);
  }

  const content = readFileSync(resolved, "utf-8");

  if (!content.trim()) {
    throw new SpecError(`Spec file is empty: ${resolved}`);
  }

  const trimmed = content.trim();

  if (/^[A-Z]{2,}-\d+$/.test(trimmed)) {
    throw new SpecError(
      `Spec file contains only a ticket reference (${trimmed}). Please provide the full spec content.`,
    );
  }

  if (/^https:\/\/linear\.app\/.+$/.test(trimmed)) {
    throw new SpecError(
      `Spec file contains only a Linear URL. Please provide the full spec content.`,
    );
  }

  const headingMatch = content.match(/^# (.+)$/m);
  const title = headingMatch
    ? headingMatch[1].trim()
    : basename(resolved, extname(resolved));

  return { source: "markdown", content, title };
}

const ISSUE_KEY_PATTERN = /^[A-Z]+-\d+$/;

export async function loadSpec(source: string): Promise<SpecPayload> {
  if (isLinearUrl(source)) {
    loadEnvFile();
    const issueId = extractLinearId(source);
    return readLinearSpec(issueId);
  }

  if (ISSUE_KEY_PATTERN.test(source)) {
    loadEnvFile();
    const hasLinear = !!process.env.LINEAR_API_KEY;
    const hasJira = !!(process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);

    if (hasLinear && !hasJira) {
      return readLinearSpec(source);
    }
    if (hasJira) {
      return readJiraSpec(source);
    }
    throw new SpecError(
      `No issue tracker configured for "${source}".\n\n` +
        `Add one of the following to your .env file:\n\n` +
        `  For Linear:\n` +
        `    LINEAR_API_KEY=lin_api_...\n\n` +
        `  For Jira:\n` +
        `    JIRA_URL=https://your-domain.atlassian.net\n` +
        `    JIRA_EMAIL=your-email@example.com\n` +
        `    JIRA_API_TOKEN=your-jira-token`,
    );
  }

  return readSpec(source);
}
