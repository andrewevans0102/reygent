import type { UsageInfo } from "../usage.js";

export type ProviderName = "claude" | "gemini" | "codex" | "openrouter";

export interface SpawnAdapterOptions {
  prompt: string;
  systemPrompt?: string;
  model: string;
  autoApprove?: boolean;
  quiet?: boolean;
  timeoutMs: number;
  agentName: string;
}

export interface SpawnResult {
  stdout: string;
  exitCode: number;
  usage?: UsageInfo;
}

export interface ModelEntry {
  id: string;
  label: string;
}

export interface ProviderAdapter {
  name: ProviderName;
  type: "cli" | "api";
  defaultModel: string;
  supportedModels: ModelEntry[];
  shortAliases: Record<string, string>;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  spawn(options: SpawnAdapterOptions): Promise<SpawnResult>;
  spawnInteractive(systemPrompt: string, model: string): Promise<number>;
}
