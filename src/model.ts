import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { TaskError } from "./task.js";

export interface ModelEntry {
  id: string;
  label: string;
}

export const SUPPORTED_MODELS: ModelEntry[] = [
  { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5 (recommended)" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const SHORT_ALIASES: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
};

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

let modelOverride: string | null = null;

export function setModelOverride(id: string): void {
  modelOverride = id;
}

export function resolveAlias(id: string): string {
  return SHORT_ALIASES[id] ?? id;
}

export function validateModel(id: string): string {
  const resolved = resolveAlias(id);
  const valid = SUPPORTED_MODELS.some((m) => m.id === resolved);
  if (!valid) {
    const list = SUPPORTED_MODELS.map((m) => `  ${m.id} — ${m.label}`).join("\n");
    const aliases = Object.entries(SHORT_ALIASES)
      .map(([alias, full]) => `  ${alias} → ${full}`)
      .join("\n");
    throw new TaskError(
      `Unknown model: ${id}\n\nSupported models:\n${list}\n\nShort aliases:\n${aliases}`,
    );
  }
  return resolved;
}

export function getConfigModel(): string | null {
  const config = loadConfig();
  return config.model ?? null;
}

/**
 * Get model from override or config. Returns null if neither set.
 */
export function getModel(): string | null {
  if (modelOverride) return modelOverride;
  const configModel = getConfigModel();
  if (configModel) {
    return validateModel(configModel);
  }
  return null;
}

/**
 * Interactive arrow-key picker. Shown once per invocation when no model configured.
 */
export async function promptModelSelection(): Promise<string> {
  const selected = await select({
    message: "Select Claude model:",
    choices: SUPPORTED_MODELS.map((m) => ({
      name: m.label,
      value: m.id,
    })),
    default: DEFAULT_MODEL,
  });
  setModelOverride(selected);
  console.log(chalk.gray(`Using model: ${selected}\n`));
  return selected;
}

/**
 * Resolve model: override → config → interactive picker.
 */
export async function resolveModel(): Promise<string> {
  const model = getModel();
  if (model) return model;
  if (!process.stdin.isTTY) {
    throw new TaskError(
      "No model configured. Pass --model <id> or set \"model\" in .reygent/config.json",
    );
  }
  return promptModelSelection();
}
