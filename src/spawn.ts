import { getProvider } from "./providers/index.js";
import { resolveModel, resolveProvider } from "./model.js";
import { TaskError } from "./task.js";
import type { ActivityEvent } from "./providers/types.js";
import type { UsageInfo } from "./usage.js";
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";
import { loadKnowledge } from "./knowledge/loader.js";
import { emitErrorTask } from "./telemetry-helpers.js";

/**
 * Result returned by provider adapter spawn() method.
 * See Provider Adapter Contract in CLAUDE.md for full details.
 */
export interface SpawnResult {
  /** Agent output text (JSON, markdown, or plain text depending on agent) */
  stdout: string;
  /** Exit code: 0 for success, non-zero for failure */
  exitCode: number;
  /** Optional cost/token telemetry for usage tracking */
  usage?: UsageInfo;
  /** Clean error message from provider API (e.g., "Model not available"). Only present on errors. */
  errorMessage?: string;
  /** HTTP status code from API error (e.g., 404, 401, 429). Only present on API errors. */
  apiErrorStatus?: number;
}

/**
 * Check if model name looks malformed (obvious user input error).
 * Returns true if model is clearly invalid, false if it could be a valid custom model.
 */
function looksLikeMalformedModel(model?: string): boolean {
  if (!model) return false;
  // Obvious signs of malformation: empty after trim, contains spaces, starts/ends with special chars
  const trimmed = model.trim();
  if (trimmed.length === 0) return true;
  if (/\s/.test(trimmed)) return true;
  if (/^[^a-zA-Z0-9]|[^a-zA-Z0-9]$/.test(trimmed)) return true;
  // Very short model names (< 3 chars) are likely typos
  if (trimmed.length < 3) return true;
  return false;
}

/**
 * Build a detail string from a SpawnResult for error messages.
 * Includes errorMessage from the provider and raw stdout as fallback.
 */
export function formatExitDetail(result: SpawnResult, model?: string): string {
  if (result.errorMessage) {
    const status = result.apiErrorStatus ? ` (HTTP ${result.apiErrorStatus})` : "";
    let detail = `\n  ${result.errorMessage}${status}`;
    // Only show model selection tip if:
    // 1. It's a 404 error with "not available" pattern AND
    // 2. Model name looks malformed (obvious typo/error)
    // This avoids confusing users who intentionally use custom models not yet synced by provider
    if (result.apiErrorStatus === 404 && /not available/i.test(result.errorMessage) && looksLikeMalformedModel(model)) {
      detail += `\n  Tip: edit .reygent/config.json "model" field, or run \`reygent config\` to pick a supported model.`;
    }
    return detail;
  }
  const trimmed = result.stdout.trim();
  if (!trimmed) return "";
  const truncated = trimmed.slice(0, 500);
  const suffix = trimmed.length > 500 ? "..." : "";
  return `\n  ${truncated}${suffix}`;
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
  const chesstrace = getChesstrace();

  const { available, reason } = await adapter.isAvailable();
  if (!available) {
    // Emit error.provider and error.task before throwing
    if (chesstrace) {
      chesstrace.emit(Events.ERROR_PROVIDER, {
        provider: providerName,
        reason,
      });
    }
    emitErrorTask(
      `Provider "${providerName}" is not available: ${reason}`,
      options?.stage ?? "spawn",
      { agent: name },
    );
    throw new TaskError(`Provider "${providerName}" is not available: ${reason}`);
  }

  const modelId = options?.model ?? await resolveModel(providerName);
  const startTime = Date.now();

  // Emit agent.spawn event before spawning
  if (chesstrace) {
    chesstrace.emit(Events.AGENT_SPAWN, {
      agent: name,
      provider: providerName,
      model: modelId,
      stage: options?.stage,
    });
  }

  // Load knowledge for agent
  const knowledge = await loadKnowledge(name, options?.stage);

  // Inject knowledge into system prompt if any exists
  let enhancedSystemPrompt = options?.systemPrompt;
  if (knowledge.entriesLoaded.length > 0) {
    const knowledgeSections: string[] = [];

    if (knowledge.commonFailures) {
      knowledgeSections.push(`### Common Failures to Avoid\n${knowledge.commonFailures}`);
    }
    if (knowledge.successPatterns) {
      knowledgeSections.push(`### Success Patterns to Follow\n${knowledge.successPatterns}`);
    }
    if (knowledge.agentTips) {
      knowledgeSections.push(`### Agent-Specific Tips (${name})\n${knowledge.agentTips}`);
    }
    if (knowledge.projectConventions) {
      knowledgeSections.push(`### Project Conventions\n${knowledge.projectConventions}`);
    }

    if (knowledgeSections.length > 0) {
      const knowledgeBlock = `\n\n## Project-Specific Knowledge\n\n${knowledgeSections.join("\n\n")}\n\n---\n\n**Important**: Review above knowledge before proceeding. Avoid documented pitfalls.`;
      enhancedSystemPrompt = (enhancedSystemPrompt || "") + knowledgeBlock;
    }

    // Emit knowledge consultation event
    if (chesstrace) {
      chesstrace.emit(Events.KNOWLEDGE_CONSULTED, {
        agent: name,
        stage: options?.stage,
        entries: knowledge.entriesLoaded,
        entryCount: knowledge.entriesLoaded.length,
      });
    }
  }

  // Track timeout state to prevent duplicate events
  let timedOut = false;

  // Setup timeout handler
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    if (chesstrace) {
      chesstrace.emit(Events.AGENT_TIMEOUT, {
        agent: name,
        stage: options?.stage,
        timeoutMs,
      });
    }
  }, timeoutMs);

  try {
    const result = await adapter.spawn({
      prompt,
      systemPrompt: enhancedSystemPrompt,
      model: modelId,
      autoApprove: options?.autoApprove,
      quiet: options?.quiet,
      timeoutMs,
      agentName: name,
      onActivity: options?.onActivity,
    });

    // Clear timeout immediately after spawn completes
    clearTimeout(timeoutHandle);

    // Only emit complete if timeout didn't fire
    if (!timedOut && chesstrace) {
      const duration = Date.now() - startTime;
      chesstrace.emit(Events.AGENT_COMPLETE, {
        agent: name,
        stage: options?.stage,
        exitCode: result.exitCode,
        duration,
        success: result.exitCode === 0,
      });
    }

    return result;
  } catch (err) {
    // Clear timeout immediately
    clearTimeout(timeoutHandle);

    // Only emit complete if timeout didn't fire
    if (!timedOut && chesstrace) {
      const duration = Date.now() - startTime;
      chesstrace.emit(Events.AGENT_COMPLETE, {
        agent: name,
        stage: options?.stage,
        exitCode: -1,
        duration,
        success: false,
      });
    }

    throw err;
  }
}
