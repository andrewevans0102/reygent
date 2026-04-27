import chalk from "chalk";
import { TaskError } from "../task.js";
import type { ProviderAdapter, SpawnAdapterOptions, SpawnResult, ModelEntry } from "./types.js";

const SUPPORTED_MODELS: ModelEntry[] = [
  { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5 via OpenRouter" },
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6 via OpenRouter" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro via OpenRouter" },
  { id: "openai/o3", label: "OpenAI o3 via OpenRouter" },
];

const SHORT_ALIASES: Record<string, string> = {};

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export const openrouterAdapter: ProviderAdapter = {
  name: "openrouter",
  type: "api",
  defaultModel: DEFAULT_MODEL,
  supportedModels: SUPPORTED_MODELS,
  shortAliases: SHORT_ALIASES,

  async isAvailable() {
    const key = process.env.OPENROUTER_API_KEY;
    if (key && key.length > 0) {
      return { available: true };
    }
    return { available: false, reason: "OPENROUTER_API_KEY environment variable not set" };
  },

  async spawn(options: SpawnAdapterOptions): Promise<SpawnResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new TaskError(
        `${options.agentName}: OPENROUTER_API_KEY environment variable not set`,
      );
    }

    const name = options.agentName;

    // Warn about file system limitations for agents with write tools
    console.log(
      chalk.yellow(`[${name}] Warning: OpenRouter is an API provider — no file system access. `) +
      chalk.yellow(`Tool calls (Bash, Write, Edit) will not work.`),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/andrewevans0102/reygent",
          "X-Title": "reygent",
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "user", content: options.prompt },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text();
        throw new TaskError(
          `${name}: OpenRouter API returned ${response.status} — ${body}`,
        );
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = data.choices?.[0]?.message?.content ?? "";
      const usage = data.usage;

      return {
        stdout: content,
        exitCode: 0,
        usage: usage ? {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
        } : undefined,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof TaskError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("aborted")) {
        throw new TaskError(`${name}: timed out after ${options.timeoutMs}ms`);
      }
      throw new TaskError(`${name}: OpenRouter API request failed — ${message}`);
    }
  },

  async spawnInteractive(): Promise<number> {
    throw new TaskError(
      "OpenRouter is an API provider and does not support interactive sessions. " +
      "Use a CLI provider (claude, gemini, codex) for interactive mode.",
    );
  },
};
