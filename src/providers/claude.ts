import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { constants } from "node:os";
import chalk from "chalk";
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

interface StreamResultMessage {
  type: "result";
  subtype: string;
  result: string;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  input_tokens?: number;
  output_tokens?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
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
];

const SHORT_ALIASES: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// Safe argv limit for interactive --append-system-prompt
const MAX_PROMPT_BYTES = 200_000;

let availabilityCache: { available: boolean; reason?: string } | null = null;

export const claudeAdapter: ProviderAdapter = {
  name: "claude",
  type: "cli",
  defaultModel: DEFAULT_MODEL,
  supportedModels: SUPPORTED_MODELS,
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
      ];
      if (options.autoApprove) {
        args.push("--allowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep");
      }

      const stdinMode = options.autoApprove === false ? "inherit" : "ignore";
      const child = spawn("claude", args, { stdio: [stdinMode, "pipe", "pipe"] });

      let resultText = "";
      let resultUsage: UsageInfo | undefined;
      const textChunks: string[] = [];
      const name = options.agentName;

      const timeout = setTimeout(() => {
        child.kill();
        reject(new TaskError(`${name}: timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      let stdoutEnded = false;
      let stderrEnded = false;
      let processExitCode: number | null = null;

      const maybeResolve = () => {
        if (stdoutEnded && stderrEnded && processExitCode !== null) {
          clearTimeout(timeout);
          const stdout = resultText || textChunks.join("\n");
          resolve({ stdout, exitCode: processExitCode, usage: resultUsage });
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

          const inputTokens = msg.input_tokens ?? msg.usage?.input_tokens;
          const outputTokens = msg.output_tokens ?? msg.usage?.output_tokens;
          const hasUsage =
            msg.cost_usd !== undefined ||
            msg.duration_ms !== undefined ||
            msg.num_turns !== undefined ||
            inputTokens !== undefined ||
            outputTokens !== undefined;

          if (hasUsage) {
            resultUsage = {
              ...(msg.cost_usd !== undefined ? { costUsd: msg.cost_usd } : {}),
              ...(msg.duration_ms !== undefined ? { durationMs: msg.duration_ms } : {}),
              ...(msg.num_turns !== undefined ? { numTurns: msg.num_turns } : {}),
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
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
      const child = spawn(
        "claude",
        ["--append-system-prompt", systemPrompt, "--model", model],
        { stdio: "inherit" },
      );

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
