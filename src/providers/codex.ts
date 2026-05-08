import { spawn } from "node:child_process";
import chalk from "chalk";
import { registerChild } from "../child-registry.js";
import { TaskError } from "../task.js";
import type { ProviderAdapter, SpawnAdapterOptions, SpawnResult, ModelEntry } from "./types.js";

const SUPPORTED_MODELS: ModelEntry[] = [
  { id: "gpt-5.4", label: "gpt-5.4" },
];

const SHORT_ALIASES: Record<string, string> = {};

const DEFAULT_MODEL = "gpt-5.4";

let availabilityCache: { available: boolean; reason?: string } | null = null;

export const codexAdapter: ProviderAdapter = {
  name: "codex",
  type: "cli",
  defaultModel: DEFAULT_MODEL,
  supportedModels: SUPPORTED_MODELS,
  shortAliases: SHORT_ALIASES,

  async isAvailable() {
    if (availabilityCache) return availabilityCache;

    const result = await new Promise<{ available: boolean; reason?: string }>((resolve) => {
      const child = spawn("which", ["codex"], { stdio: "pipe" });
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({ available: false, reason: "codex CLI not found in PATH" });
        }
      });
      child.on("error", () => {
        resolve({ available: false, reason: "codex CLI not found in PATH" });
      });
    });

    availabilityCache = result;
    return result;
  },

  async spawn(options: SpawnAdapterOptions): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const args = ["exec", options.prompt, "--json"];
      if (options.model) {
        args.push("--model", options.model);
      }
      if (options.autoApprove) {
        args.push("--full-auto");
      }

      const name = options.agentName;
      const stdinMode = options.autoApprove === false ? "inherit" : "ignore";
      const child = spawn("codex", args, { stdio: [stdinMode, "pipe", "pipe"] });
      registerChild(child);

      let stdout = "";

      const timeout = setTimeout(() => {
        child.kill();
        reject(new TaskError(`${name}: timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (options.onActivity) {
          const line = text.trim();
          if (line) options.onActivity({ agent: name, detail: line.slice(0, 80) });
        } else {
          process.stderr.write(`${chalk.gray(`[${name}]`)} ${text}`);
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new TaskError(`${name}: failed to spawn codex — ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        const durationMs = Math.max(0, Date.now() - startTime);

        // Try to parse Codex JSON output
        let resultText = stdout;
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let cachedTokens: number | undefined;
        try {
          const parsed = JSON.parse(stdout) as {
            response?: string;
            text?: string;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              prompt_tokens_details?: { cached_tokens?: number };
            };
            input_tokens?: number;
            output_tokens?: number;
            cached_tokens?: number;
          };
          resultText = parsed.response ?? parsed.text ?? stdout;
          inputTokens = parsed.usage?.prompt_tokens ?? parsed.input_tokens;
          outputTokens = parsed.usage?.completion_tokens ?? parsed.output_tokens;
          cachedTokens = parsed.usage?.prompt_tokens_details?.cached_tokens ?? parsed.cached_tokens;
        } catch {
          // Raw text output — use as-is
        }

        resolve({
          stdout: resultText,
          exitCode: code ?? 1,
          usage: {
            durationMs,
            inputTokens,
            outputTokens,
            cachedTokens,
            // Note: cacheWriteTokens not extracted — OpenAI doesn't currently expose this field
            provider: "codex",
          },
        });
      });
    });
  },

  async spawnInteractive(systemPrompt: string, model: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Codex CLI has no --system-prompt flag; pass instructions as initial prompt
      const child = spawn(
        "codex",
        ["--model", model, systemPrompt],
        { stdio: "inherit" },
      );
      registerChild(child);

      child.on("error", (err) => {
        reject(
          new TaskError(
            `Failed to start codex CLI: ${err.message}. Is codex installed?`,
          ),
        );
      });

      child.on("close", (code) => {
        resolve(code ?? 0);
      });
    });
  },
};
