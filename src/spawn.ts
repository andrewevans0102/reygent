import { getProvider } from "./providers/index.js";
import { resolveModel, resolveProvider } from "./model.js";
import { TaskError } from "./task.js";
import type { ActivityEvent } from "./providers/types.js";
import type { UsageInfo } from "./usage.js";
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";

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
  stage?: string;
}

/**
 * Spawns an agent in stream mode with a single prompt.
 * Interactive mode (via spawnInteractive) does not support onActivity
 * since it's used for terminal sessions where live status is not applicable.
 */
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

  const chesstrace = getChesstrace();
  const startTime = Date.now();

  // Emit agent.spawn event before spawning
  chesstrace.emit(Events.AGENT_SPAWN, {
    agent: name,
    provider: providerName,
    model: modelId,
    stage: options?.stage,
  });

  // Setup timeout handler
  const timeoutHandle = setTimeout(() => {
    chesstrace.emit(Events.AGENT_TIMEOUT, {
      agent: name,
      stage: options?.stage,
      timeoutMs,
    });
  }, timeoutMs);

  try {
    const result = await adapter.spawn({
      prompt,
      systemPrompt: options?.systemPrompt,
      model: modelId,
      autoApprove: options?.autoApprove,
      quiet: options?.quiet,
      timeoutMs,
      agentName: name,
      onActivity: options?.onActivity,
    });

    clearTimeout(timeoutHandle);

    // Emit agent.complete event after spawn returns
    const duration = Date.now() - startTime;
    chesstrace.emit(Events.AGENT_COMPLETE, {
      agent: name,
      stage: options?.stage,
      exitCode: result.exitCode,
      duration,
      success: result.exitCode === 0,
    });

    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    const duration = Date.now() - startTime;
    chesstrace.emit(Events.AGENT_COMPLETE, {
      agent: name,
      stage: options?.stage,
      exitCode: -1,
      duration,
      success: false,
    });
    throw err;
  }
}
