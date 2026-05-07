import type { UsageInfo } from "../usage.js";
import type { ProviderName } from "../pricing.js";

export type { ProviderName };

export interface ActivityEvent {
  agent: string;
  tool?: string;
  detail?: string;
}

export interface SpawnAdapterOptions {
  prompt: string;
  systemPrompt?: string;
  model: string;
  autoApprove?: boolean;
  quiet?: boolean;
  timeoutMs: number;
  agentName: string;
  onActivity?: (event: ActivityEvent) => void;
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
