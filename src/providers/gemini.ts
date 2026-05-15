import { spawn } from "node:child_process";
import chalk from "chalk";
import { registerChildProcess } from "../child-registry.js";
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
      const startTime = Date.now();
      const args = ["-p", options.prompt, "--output-format", "json"];
      if (options.model) {
        args.push("--model", options.model);
      }

      const name = options.agentName;
      const stdinMode = options.autoApprove === false ? "inherit" : "ignore";

      // Detect Vertex AI configuration
      const vertexProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
      const vertexRegion = process.env.GOOGLE_CLOUD_REGION;
      const hasVertexConfig = !!vertexProject;

      // Log Vertex AI detection in debug mode or when first agent runs
      if (hasVertexConfig && !options.quiet) {
        const region = vertexRegion ?? "(using CLI default)";
        process.stderr.write(
          chalk.gray(`[${name}] Vertex AI detected: project=${vertexProject}, region=${region}\n`)
        );
      }

      // Gemini CLI requires workspace trust for non-interactive spawns;
      // without this it exits 55 when stdin is not a TTY.
      const child = spawn("gemini", args, {
        stdio: [stdinMode, "pipe", "pipe"],
        env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
        detached: false, // Keep in same process group so we can kill descendants
      });
      registerChildProcess(child);

      let stdout = "";

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

      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const stderrChunks: string[] = [];
      child.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrChunks.push(text);
        if (options.onActivity) {
          const line = text.trim();
          if (line) options.onActivity({ agent: name, detail: line.slice(0, 80) });
        } else {
          process.stderr.write(`${chalk.gray(`[${name}]`)} ${text}`);
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new TaskError(`${name}: failed to spawn gemini — ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        const durationMs = Math.max(0, Date.now() - startTime);

        // Try to parse Gemini JSON output
        let resultText = stdout;
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let cachedTokens: number | undefined;
        let errorMessage: string | undefined;
        let apiErrorStatus: number | undefined;

        try {
          const parsed = JSON.parse(stdout) as {
            response?: string;
            text?: string;
            error?: { message?: string; code?: number; status?: number };
            usage_metadata?: {
              prompt_token_count?: number;
              candidates_token_count?: number;
              cached_content_token_count?: number;
            };
            input_tokens?: number;
            output_tokens?: number;
          };
          resultText = parsed.response ?? parsed.text ?? stdout;
          inputTokens = parsed.usage_metadata?.prompt_token_count ?? parsed.input_tokens;
          outputTokens = parsed.usage_metadata?.candidates_token_count ?? parsed.output_tokens;
          cachedTokens = parsed.usage_metadata?.cached_content_token_count;

          // Extract error details if present
          if (parsed.error) {
            errorMessage = parsed.error.message;
            // Gemini error codes can be numeric (HTTP status) or string codes
            // Map known codes to HTTP status for consistent handling
            let statusCode = parsed.error.status;
            if (parsed.error.code) {
              if (typeof parsed.error.code === "number") {
                // Gemini often returns HTTP status codes directly
                statusCode = parsed.error.code;
              } else if (typeof parsed.error.code === "string") {
                // String error codes - map to HTTP status
                const code = parsed.error.code.toLowerCase();
                if (code === "not_found" || code === "model_not_found") {
                  statusCode = 404;
                } else if (code === "permission_denied" || code === "unauthenticated") {
                  statusCode = 403;
                } else if (code === "invalid_api_key" || code === "invalid_authentication") {
                  statusCode = 401;
                } else if (code === "resource_exhausted" || code === "rate_limit_exceeded") {
                  statusCode = 429;
                } else if (code === "internal" || code === "server_error") {
                  statusCode = 500;
                } else if (code === "invalid_argument") {
                  statusCode = 400;
                }
              }
            }
            apiErrorStatus = statusCode;
          }
        } catch {
          // Raw text output — use as-is
        }

        // If exitCode non-zero and no structured error, try stderr
        if (code !== 0 && !errorMessage && stderrChunks.length > 0) {
          const stderr = stderrChunks.join("").trim();
          if (stderr) {
            errorMessage = stderr;
          }
        }

        resolve({
          stdout: resultText,
          exitCode: code ?? 1,
          usage: {
            durationMs,
            inputTokens,
            outputTokens,
            cachedTokens,
            provider: "gemini",
          },
          errorMessage,
          apiErrorStatus,
        });
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
        { stdio: "inherit", env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" } },
      );
      registerChildProcess(child);

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
