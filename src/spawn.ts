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
  /** Captured stderr output (may be truncated). Useful for diagnosing CLI failures. */
  stderr?: string;
  /** Signal name if the child was killed by a signal (e.g., "SIGTRAP", "SIGTERM"). */
  signal?: string;
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
  // Detect trusted directory / git repo check failure from Claude CLI
  const combined = `${result.stdout}\n${result.stderr ?? ""}`;
  if (/trusted directory|skip-git-repo-check/i.test(combined)) {
    return `\n  Claude CLI does not trust this directory.\n\n  To fix, do one of:\n    1. Run \`claude\` interactively here once and approve the trust prompt\n    2. Initialize a git repo: git init\n\n  Then re-run \`reygent run\`.`;
  }

  const parts: string[] = [];

  // Surface signal info first — often the most important diagnostic
  if (result.signal) {
    const sigHints: Record<string, string> = {
      SIGTRAP: "process hit a fatal trap (common cause: V8 memory/address-space limit exceeded)",
      SIGKILL: "process was forcibly killed (OOM killer or external signal)",
      SIGTERM: "process was terminated (timeout or manual kill)",
      SIGSEGV: "segmentation fault (memory access violation)",
      SIGABRT: "process aborted (assertion failure or fatal error)",
    };
    const hint = sigHints[result.signal] ?? "";
    parts.push(`killed by ${result.signal}${hint ? ` — ${hint}` : ""}`);
  }

  if (result.errorMessage) {
    const status = result.apiErrorStatus ? ` (HTTP ${result.apiErrorStatus})` : "";
    parts.push(`${result.errorMessage}${status}`);
    if (result.apiErrorStatus === 404 && /not available/i.test(result.errorMessage) && looksLikeMalformedModel(model)) {
      parts.push(`Tip: edit .reygent/config.json "model" field, or run \`reygent config\` to pick a supported model.`);
    }
  }

  // Include stderr snippet when no structured error — often contains the real diagnostic
  if (!result.errorMessage && result.stderr) {
    const stderrTrimmed = result.stderr.trim();
    if (stderrTrimmed) {
      const truncated = stderrTrimmed.slice(0, 500);
      const suffix = stderrTrimmed.length > 500 ? "..." : "";
      parts.push(`stderr: ${truncated}${suffix}`);
    }
  }

  // Fallback to stdout if nothing else
  if (parts.length === 0) {
    const trimmed = result.stdout.trim();
    if (!trimmed) return "";
    const truncated = trimmed.slice(0, 500);
    const suffix = trimmed.length > 500 ? "..." : "";
    parts.push(truncated + suffix);
  }

  return "\n  " + parts.join("\n  ");
}

export interface SpawnOptions {
  quiet?: boolean;
  autoApprove?: boolean;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  onActivity?: (event: ActivityEvent) => void;
  stage?: string;
  /** Restrict which tools the agent can use. Empty array = no tools. */
  allowedTools?: string[];
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

  // Always append resource constraints — applies regardless of config source
  // (built-in agents, local config, or global config).
  const resourceConstraints = `\n\n## Resource Constraints (mandatory)\n\n- Run all commands sequentially. Never run commands in parallel or in the background.\n- Do not spawn detached or background processes.\n- When running tests, always use single-worker mode: --maxWorkers=1 (jest), --maxThreads=1 --maxForks=1 (vitest), or equivalent.\n- Never use watch mode (--watch, --watchAll).\n- Avoid spawning unnecessary subprocesses. Prefer direct commands over npx when possible.`;
  enhancedSystemPrompt = (enhancedSystemPrompt || "") + resourceConstraints;

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
      allowedTools: options?.allowedTools,
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
