import { TaskError } from "../task.js";
import type { ProviderAdapter, ProviderName } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { geminiAdapter } from "./gemini.js";
import { codexAdapter } from "./codex.js";
import { openrouterAdapter } from "./openrouter.js";

export type { ProviderAdapter, ProviderName, SpawnAdapterOptions, SpawnResult, ModelEntry } from "./types.js";

const providers: Record<ProviderName, ProviderAdapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  openrouter: openrouterAdapter,
};

export const PROVIDER_NAMES = Object.keys(providers) as ProviderName[];

export function getProvider(name: string): ProviderAdapter {
  const adapter = providers[name as ProviderName];
  if (!adapter) {
    const valid = PROVIDER_NAMES.join(", ");
    throw new TaskError(`Unknown provider: "${name}". Valid providers: ${valid}`);
  }
  return adapter;
}
