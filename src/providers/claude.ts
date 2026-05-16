import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { constants } from "node:os";
import chalk from "chalk";
import { registerChildProcess } from "../child-registry.js";
import { TaskError } from "../task.js";
import type { UsageInfo } from "../usage.js";
import type { ProviderAdapter, SpawnAdapterOptions, SpawnResult, ModelEntry } from "./types.js";

interface StreamAssistantMessage {
  type: "assistant";
  message: {
    content: Array<
      | { type: "tool_use"; name: string; input: Record<string, unknown> }
      | { type: "text"; text: string }
    >;
  };
}

export interface StreamResultMessage {
  type: "result";
  subtype: string;
  result: string;
  is_error?: boolean;
  api_error_status?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  input_tokens?: number;
  output_tokens?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

type StreamEvent = StreamAssistantMessage | StreamResultMessage | { type: string };

function formatToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return typeof input.file_path === "string" ? input.file_path : "";
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
    }
    case "Glob":
      return typeof input.pattern === "string" ? input.pattern : "";
    case "Grep":
      return typeof input.pattern === "string" ? `/${input.pattern}/` : "";
    default:
      return "";
  }
}

const SUPPORTED_MODELS: ModelEntry[] = [
  { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5 (recommended)" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-20250514", label: "Sonnet 4" },
  { id: "claude-3-5-sonnet-20241022", label: "3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", label: "3.5 Haiku" },
  { id: "claude-3-opus-20240229", label: "3 Opus" },
];

const VERTEX_AI_MODELS: ModelEntry[] = [
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-sonnet-4-5@20250929", label: "Sonnet 4.5 (recommended)" },
  { id: "claude-sonnet-4@20250514", label: "Sonnet 4 (deprecated)" },
  { id: "claude-opus-4-5@20251101", label: "Opus 4.5" },
  { id: "claude-opus-4-1@20250805", label: "Opus 4.1" },
  { id: "claude-opus-4@20250514", label: "Opus 4 (deprecated)" },
  { id: "claude-haiku-4-5@20251001", label: "Haiku 4.5" },
  { id: "claude-3-5-haiku@20241022", label: "3.5 Haiku (deprecated)" },
];

const SHORT_ALIASES: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku": "claude-3-5-haiku-20241022",
  "claude-3.5-haiku": "claude-3-5-haiku-20241022",
  "claude-3-opus": "claude-3-opus-20240229",
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// Track Vertex AI detection to log only once per session
let vertexAiLoggedForClaude = false;

// Track non-git-repo warning to show only once per process
let gitRepoWarningShown = false;

/** Extract token counts from a Claude CLI stream result message. */
export function extractTokenUsage(msg: StreamResultMessage): {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cachedTokens: number | undefined;
  cacheWriteTokens: number | undefined;
} {
  const usageData = msg.usage;
  const hasInput = usageData?.input_tokens !== undefined ||
    usageData?.cache_creation_input_tokens !== undefined ||
    usageData?.cache_read_input_tokens !== undefined ||
    msg.input_tokens !== undefined;
  const baseInput = usageData?.input_tokens ?? msg.input_tokens ?? 0;
  const cacheCreation = usageData?.cache_creation_input_tokens ?? 0;
  const cacheRead = usageData?.cache_read_input_tokens ?? 0;
  const inputTokens = hasInput ? baseInput + cacheCreation + cacheRead : undefined;
  // outputTokens: no cache fields apply to output, so undefined means "no data"
  const outputTokens = usageData?.output_tokens ?? msg.output_tokens;

  const cachedTokens = usageData?.cache_read_input_tokens !== undefined
    ? usageData.cache_read_input_tokens
    : undefined;
  const cacheWriteTokens = usageData?.cache_creation_input_tokens !== undefined
    ? usageData.cache_creation_input_tokens
    : undefined;

  return { inputTokens, outputTokens, cachedTokens, cacheWriteTokens };
}

// Safe argv limit for interactive --append-system-prompt
const MAX_PROMPT_BYTES = 200_000;

let availabilityCache: { available: boolean; reason?: string } | null = null;

export const claudeAdapter: ProviderAdapter = {
  name: "claude",
  type: "cli",
  defaultModel: DEFAULT_MODEL,
  supportedModels: SUPPORTED_MODELS,
  vertexModels: VERTEX_AI_MODELS,
  shortAliases: SHORT_ALIASES,

  async isAvailable() {
    if (availabilityCache) return availabilityCache;

    const result = await new Promise<{ available: boolean; reason?: string }>((resolve) => {
      const child = spawn("which", ["claude"], { stdio: "pipe" });
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({ available: false, reason: "claude CLI not found in PATH" });
        }
      });
      child.on("error", () => {
        resolve({ available: false, reason: "claude CLI not found in PATH" });
      });
    });

    availabilityCache = result;
    return result;
  },

  async spawn(options: SpawnAdapterOptions): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p", options.prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--model", options.model,
        "--skip-git-repo-check",
      ];
      if (options.allowedTools !== undefined) {
        // Explicit tool restriction: empty array = no tools allowed
        if (options.allowedTools.length > 0) {
          args.push("--allowedTools", ...options.allowedTools);
        }
      } else if (options.autoApprove) {
        args.push("--allowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep");
      }

      const name = options.agentName;

      // Detect Vertex AI configuration for Claude via Model Garden
      const vertexProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
      const vertexRegion = process.env.GOOGLE_CLOUD_REGION;
      const hasVertexConfig = !!vertexProject;

      // Log Vertex AI detection only once per session to avoid spam
      if (hasVertexConfig && !options.quiet && !vertexAiLoggedForClaude) {
        const region = vertexRegion ?? "(using CLI default)";
        process.stderr.write(
          chalk.gray(`[${name}] Vertex AI detected: project=${vertexProject}, region=${region}\n`)
        );
        vertexAiLoggedForClaude = true;
      }

      if (!gitRepoWarningShown && !options.quiet) {
        const hasGit = existsSync(join(process.cwd(), ".git"));
        if (!hasGit) {
          process.stderr.write(
            chalk.yellow("⚠ Not in a git repo — file changes won't be version-controlled. Consider running git init.\n")
          );
          gitRepoWarningShown = true;
        }
      }

      const stdinMode = options.autoApprove === false ? "inherit" : "ignore";
      const child = spawn("claude", args, {
        stdio: [stdinMode, "pipe", "pipe"],
        detached: false, // Keep in same process group so we can kill descendants
      });
      registerChildProcess(child);

      let resultText = "";
      let resultErrorMessage: string | undefined;
      let resultApiErrorStatus: number | undefined;
      let resultUsage: UsageInfo | undefined;
      const textChunks: string[] = [];

      const timeout = setTimeout(() => {
        // Kill entire process group to catch spawned descendants
        if (child.pid && process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill();
          }
        } else {
          child.kill();
        }
        reject(new TaskError(`${name}: timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      let stdoutEnded = false;
      let stderrEnded = false;
      let processExitCode: number | null = null;

      const maybeResolve = () => {
        if (stdoutEnded && stderrEnded && processExitCode !== null) {
          clearTimeout(timeout);
          const stdout = resultText || textChunks.join("\n");
          resolve({
            stdout,
            exitCode: processExitCode,
            usage: resultUsage,
            errorMessage: resultErrorMessage,
            apiErrorStatus: resultApiErrorStatus,
          });
        }
      };

      const stdoutRL = createInterface({ input: child.stdout! });
      stdoutRL.on("line", (line) => {
        if (!line.trim()) return;

        let event: StreamEvent;
        try {
          event = JSON.parse(line) as StreamEvent;
        } catch {
          console.log(chalk.gray(`[${name}]`), line);
          return;
        }

        if (event.type === "assistant") {
          const msg = event as StreamAssistantMessage;
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
              const detail = formatToolDetail(block.name, block.input);
              if (options.onActivity) {
                options.onActivity({ agent: name, tool: block.name, detail: detail || undefined });
              } else {
                const suffix = detail ? ` ${chalk.gray(detail)}` : "";
                process.stderr.write(`${chalk.gray(`[${name}]`)} ${chalk.cyan("→")} ${chalk.blue(block.name)}${suffix}\n`);
              }
            } else if (block.type === "text") {
              if (!options.quiet && !options.onActivity) {
                console.log(chalk.gray(`[${name}]`), block.text);
              }
              textChunks.push(block.text);
            }
          }
        } else if (event.type === "result") {
          const msg = event as StreamResultMessage;
          resultText = msg.result;
          if (msg.is_error) {
            resultErrorMessage = msg.result;
            resultApiErrorStatus = msg.api_error_status;
          }

          const { inputTokens, outputTokens, cachedTokens, cacheWriteTokens } = extractTokenUsage(msg);
          const hasUsage =
            msg.total_cost_usd !== undefined ||
            msg.duration_ms !== undefined ||
            msg.num_turns !== undefined ||
            inputTokens !== undefined ||
            outputTokens !== undefined;

          if (hasUsage) {
            resultUsage = {
              ...(msg.total_cost_usd !== undefined ? { costUsd: msg.total_cost_usd } : {}),
              ...(msg.duration_ms !== undefined ? { durationMs: msg.duration_ms } : {}),
              ...(msg.num_turns !== undefined ? { numTurns: msg.num_turns } : {}),
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
              ...(cachedTokens !== undefined ? { cachedTokens } : {}),
              ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
              provider: "claude",
            };
          }
        }
      });
      stdoutRL.on("close", () => {
        stdoutEnded = true;
        maybeResolve();
      });

      const stderrRL = createInterface({ input: child.stderr! });
      stderrRL.on("line", (line) => {
        if (options.onActivity) {
          options.onActivity({ agent: name, detail: line.slice(0, 80) });
        } else {
          process.stderr.write(`${chalk.gray(`[${name}]`)} ${line}\n`);
        }
      });
      stderrRL.on("close", () => {
        stderrEnded = true;
        maybeResolve();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new TaskError(`${name}: failed to spawn — ${err.message}`));
      });

      child.on("close", (code) => {
        processExitCode = code ?? 1;
        maybeResolve();
      });
    });
  },

  async spawnInteractive(systemPrompt: string, model: string): Promise<number> {
    const promptBytes = Buffer.byteLength(systemPrompt);

    if (promptBytes > MAX_PROMPT_BYTES) {
      throw new TaskError(
        `System prompt too large (${promptBytes} bytes, limit ${MAX_PROMPT_BYTES}). ` +
        `Try a smaller spec or split into sections.`,
      );
    }

    return new Promise((resolve, reject) => {
      if (!gitRepoWarningShown) {
        const hasGit = existsSync(join(process.cwd(), ".git"));
        if (!hasGit) {
          process.stderr.write(
            chalk.yellow("⚠ Not in a git repo — file changes won't be version-controlled. Consider running git init.\n")
          );
          gitRepoWarningShown = true;
        }
      }

      const child = spawn(
        "claude",
        ["--append-system-prompt", systemPrompt, "--model", model, "--skip-git-repo-check"],
        {
          stdio: "inherit",
          detached: false, // Keep in same process group so we can kill descendants
        },
      );
      registerChildProcess(child);

      child.on("error", (err) => {
        reject(
          new TaskError(
            `Failed to start ${this.name} CLI: ${err.message}. Is ${this.name} installed?`,
          ),
        );
      });

      child.on("close", (code, signal) => {
        if (signal) {
          const sigNum = constants.signals[signal];
          resolve(sigNum ? 128 + sigNum : 1);
        } else {
          resolve(code ?? 0);
        }
      });
    });
  },
};
