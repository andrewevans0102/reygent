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
  /** Restrict which tools the agent can use. Empty array = no tools. */
  allowedTools?: string[];
}

export interface SpawnResult {
  stdout: string;
  exitCode: number;
  usage?: UsageInfo;
  errorMessage?: string;
  apiErrorStatus?: number;
  /** Captured stderr output (may be truncated). Useful for diagnosing CLI failures. */
  stderr?: string;
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
  /** Vertex AI model variants (uses @date format instead of -date). */
  vertexModels?: ModelEntry[];
  shortAliases: Record<string, string>;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  spawn(options: SpawnAdapterOptions): Promise<SpawnResult>;
  spawnInteractive(systemPrompt: string, model: string): Promise<number>;
}
