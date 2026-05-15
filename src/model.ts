import chalk from "chalk";
import { loadConfig } from "./config.js";
import { TaskError } from "./task.js";
import { getProvider } from "./providers/index.js";
import type { ModelEntry } from "./providers/types.js";

// Re-export for backward compat
export type { ModelEntry };

// Legacy exports — delegate to Claude adapter
export const SUPPORTED_MODELS: ModelEntry[] = getProvider("claude").supportedModels;
export const DEFAULT_MODEL = getProvider("claude").defaultModel;

let modelOverride: string | null = null;
let providerOverride: string | null = null;

export function setModelOverride(id: string): void {
  modelOverride = id;
}

export function setProviderOverride(name: string): void {
  providerOverride = name;
}

/**
 * Resolve alias for a given provider. Falls back to identity if no alias found.
 */
export function resolveAlias(id: string, providerName?: string): string {
  const provider = getProvider(providerName ?? resolveProvider());
  return provider.shortAliases[id] ?? id;
}

/**
 * Validate model ID against a provider's supported models.
 * If provider not specified, uses resolved provider.
 * Pass-through providers (openrouter) accept any model.
 * Custom models (not in supported list) trigger a warning but are allowed.
 */
export function validateModel(id: string, providerName?: string): string {
  const name = providerName ?? resolveProvider();
  const provider = getProvider(name);
  const resolved = provider.shortAliases[id] ?? id;

  // OpenRouter accepts any model slug — pass-through
  if (name === "openrouter") return resolved;

  // Check if model in supported list
  const valid = provider.supportedModels.some((m) => m.id === resolved);
  if (!valid) {
    // Allow custom models but warn user
    const list = provider.supportedModels.map((m) => `  ${m.id} — ${m.label}`).join("\n");
    const aliases = Object.entries(provider.shortAliases)
      .map(([alias, full]) => `  ${alias} → ${full}`)
      .join("\n");
    console.log(chalk.yellow("Warning:"), `"${id}" not in ${name} supported models list. Using custom model.`);
    console.log(chalk.gray("Supported models for"), chalk.cyan(name) + chalk.gray(":"));
    console.log(list);
    if (aliases) {
      console.log(chalk.gray("\nShort aliases:"));
      console.log(aliases);
    }
    console.log("");
  }
  return resolved;
}

export function getConfigModel(): string | null {
  const config = loadConfig();
  return config.model ?? null;
}

/**
 * Resolve provider: CLI flag → config → "claude"
 */
export function resolveProvider(agentProvider?: string): string {
  if (agentProvider) return agentProvider;
  if (providerOverride) return providerOverride;
  const config = loadConfig();
  return config.provider ?? "claude";
}

/**
 * Get model from override or config. Returns null if neither set.
 */
export function getModel(providerName?: string): string | null {
  if (modelOverride) return modelOverride;
  const configModel = getConfigModel();
  if (configModel) {
    return validateModel(configModel, providerName);
  }
  return null;
}

/**
 * Resolve model: override → config → provider default.
 */
export async function resolveModel(providerName?: string): Promise<string> {
  const name = providerName ?? resolveProvider();
  const model = getModel(name);
  if (model) return model;

  // Use provider default when no explicit model configured
  return getProvider(name).defaultModel;
}
