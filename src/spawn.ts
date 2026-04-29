import { getProvider } from "./providers/index.js";
import { resolveModel, resolveProvider } from "./model.js";
import { TaskError } from "./task.js";
import type { ActivityEvent } from "./providers/types.js";
import type { UsageInfo } from "./usage.js";

export interface SpawnResult {
  stdout: string;
  exitCode: number;
  usage?: UsageInfo;
}

export interface SpawnOptions {
  quiet?: boolean;
  autoApprove?: boolean;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  onActivity?: (event: ActivityEvent) => void;
}

export async function spawnAgentStream(
  name: string,
  prompt: string,
  timeoutMs: number,
  options?: SpawnOptions,
): Promise<SpawnResult> {
  const providerName = options?.provider ?? resolveProvider();
  const adapter = getProvider(providerName);

  const { available, reason } = await adapter.isAvailable();
  if (!available) {
    throw new TaskError(`Provider "${providerName}" is not available: ${reason}`);
  }

  const modelId = options?.model ?? await resolveModel(providerName);

  return adapter.spawn({
    prompt,
    systemPrompt: options?.systemPrompt,
    model: modelId,
    autoApprove: options?.autoApprove,
    quiet: options?.quiet,
    timeoutMs,
    agentName: name,
    onActivity: options?.onActivity,
  });
}
