import { spawn } from "node:child_process";
import chalk from "chalk";
import { TaskError } from "../task.js";
import type { ProviderAdapter, SpawnAdapterOptions, SpawnResult, ModelEntry } from "./types.js";

const SUPPORTED_MODELS: ModelEntry[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (recommended)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

const SHORT_ALIASES: Record<string, string> = {};

const DEFAULT_MODEL = "gemini-2.5-pro";

let availabilityCache: { available: boolean; reason?: string } | null = null;

export const geminiAdapter: ProviderAdapter = {
  name: "gemini",
  type: "cli",
  defaultModel: DEFAULT_MODEL,
  supportedModels: SUPPORTED_MODELS,
  shortAliases: SHORT_ALIASES,

  async isAvailable() {
    if (availabilityCache) return availabilityCache;

    const result = await new Promise<{ available: boolean; reason?: string }>((resolve) => {
      const child = spawn("which", ["gemini"], { stdio: "pipe" });
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({ available: false, reason: "gemini CLI not found in PATH" });
        }
      });
      child.on("error", () => {
        resolve({ available: false, reason: "gemini CLI not found in PATH" });
      });
    });

    availabilityCache = result;
    return result;
  },

  async spawn(options: SpawnAdapterOptions): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const args = ["-p", options.prompt, "--output-format", "json"];
      if (options.model) {
        args.push("--model", options.model);
      }

      const name = options.agentName;
      const stdinMode = options.autoApprove === false ? "inherit" : "ignore";
      const child = spawn("gemini", args, { stdio: [stdinMode, "pipe", "pipe"] });

      let stdout = "";

      const timeout = setTimeout(() => {
        child.kill();
        reject(new TaskError(`${name}: timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const stderrChunks: string[] = [];
      child.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrChunks.push(text);
        process.stderr.write(`${chalk.gray(`[${name}]`)} ${text}`);
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new TaskError(`${name}: failed to spawn gemini — ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);

        // Try to parse Gemini JSON output
        let resultText = stdout;
        try {
          const parsed = JSON.parse(stdout) as { response?: string; text?: string };
          resultText = parsed.response ?? parsed.text ?? stdout;
        } catch {
          // Raw text output — use as-is
        }

        resolve({ stdout: resultText, exitCode: code ?? 1 });
      });
    });
  },

  async spawnInteractive(systemPrompt: string, model: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Gemini CLI has no --system-prompt flag; use -i to inject instructions
      // then continue interactively
      const child = spawn(
        "gemini",
        ["--model", model, "-i", `Follow these instructions for this session:\n\n${systemPrompt}`],
        { stdio: "inherit" },
      );

      child.on("error", (err) => {
        reject(
          new TaskError(
            `Failed to start gemini CLI: ${err.message}. Is gemini installed?`,
          ),
        );
      });

      child.on("close", (code) => {
        resolve(code ?? 0);
      });
    });
  },
};
