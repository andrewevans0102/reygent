import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

export interface SpecPayload {
  source: "markdown";
  content: string;
  title: string;
}

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

export function readSpec(filePath: string): SpecPayload {
  const resolved = resolve(process.cwd(), filePath);

  if (!existsSync(resolved)) {
    throw new SpecError(`File not found: ${resolved}`);
  }

  const ext = extname(resolved).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    console.warn(`Warning: ${basename(resolved)} is not a .md file`);
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
