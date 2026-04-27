import { getProvider } from "./providers/index.js";
import { resolveModel, resolveProvider } from "./model.js";
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
}

export async function spawnAgentStream(
  name: string,
  prompt: string,
  timeoutMs: number,
  options?: SpawnOptions,
): Promise<SpawnResult> {
  const providerName = options?.provider ?? resolveProvider();
  const adapter = getProvider(providerName);
  const modelId = options?.model ?? await resolveModel(providerName);

  return adapter.spawn({
    prompt,
    model: modelId,
    autoApprove: options?.autoApprove,
    quiet: options?.quiet,
    timeoutMs,
    agentName: name,
  });
}
