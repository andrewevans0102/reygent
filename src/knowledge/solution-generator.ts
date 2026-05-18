import type { FailurePattern } from "./analyzer.js";
import type { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events } from "../chesstrace/events.js";
import { resolveProvider, resolveModel } from "../model.js";
import { getProvider } from "../providers/index.js";

const RELEVANT_EVENTS = new Set([
  Events.ERROR_TASK,
  Events.AGENT_SPAWN,
  Events.AGENT_COMPLETE,
  Events.TOOL_INVOKE,
  Events.PIPELINE_STAGE_START,
  Events.PIPELINE_STAGE_END,
  Events.GATE_RESULT,
]);

const MAX_CONTEXT_EVENTS = 20;
const MAX_SOLUTION_LENGTH = 500;
const TIMEOUT_MS = 30_000;

function buildFallback(pattern: FailurePattern): string {
  const agents = pattern.agents.join(", ");
  return `Error occurred ${pattern.occurrences} time(s) in agent(s): ${agents}. Check the ${pattern.agents[0]} agent configuration and recent telemetry (reygent telemetry) for error context and stack traces.`;
}

function sanitizeSolution(raw: string): string {
  let text = raw.trim();
  // Strip markdown headers
  text = text.replace(/^#{1,6}\s+.*$/gm, "").trim();
  // Truncate
  if (text.length > MAX_SOLUTION_LENGTH) {
    text = text.slice(0, MAX_SOLUTION_LENGTH).trimEnd();
    // Avoid cutting mid-word
    const lastSpace = text.lastIndexOf(" ");
    if (lastSpace > MAX_SOLUTION_LENGTH * 0.8) {
      text = text.slice(0, lastSpace);
    }
    text += "...";
  }
  return text;
}

function formatContextEvents(
  events: Array<{ event: string; timestamp: number; data: Record<string, unknown> }>,
): string {
  return events
    .map((e) => {
      const dataStr = JSON.stringify(e.data).slice(0, 200);
      return `- [${e.event}] ${dataStr}`;
    })
    .join("\n");
}

export async function generateSolution(
  pattern: FailurePattern,
  backend: SqliteBackend,
  agentName: string,
): Promise<string> {
  try {
    const providerName = resolveProvider();
    const adapter = getProvider(providerName);

    const { available } = await adapter.isAvailable();
    if (!available) {
      return buildFallback(pattern);
    }

    const model = await resolveModel(providerName);

    // Gather context from most recent failing run
    const lastRunId = pattern.runIds[pattern.runIds.length - 1];
    let contextStr = "";
    try {
      const runEvents = await backend.query({ runId: lastRunId });
      const relevant = runEvents
        .filter((e) => RELEVANT_EVENTS.has(e.event))
        .slice(-MAX_CONTEXT_EVENTS);
      if (relevant.length > 0) {
        contextStr = formatContextEvents(relevant);
      }
    } catch {
      // Context gathering failed — proceed without it
    }

    const systemPrompt =
      "You are a concise engineering assistant. Given an error pattern from an automated pipeline, produce a 2-4 sentence actionable solution. Focus on the root cause and specific fix. No markdown headers. No preamble.";

    let prompt = `Error pattern: "${pattern.pattern}"\nAgent: ${agentName}\nOccurrences: ${pattern.occurrences}`;
    if (contextStr) {
      prompt += `\n\nRecent run context:\n${contextStr}`;
    }
    prompt += "\n\nProvide a concise, actionable solution.";

    const result = await adapter.spawn({
      prompt,
      systemPrompt,
      model,
      allowedTools: [],
      timeoutMs: TIMEOUT_MS,
      quiet: true,
      agentName: "knowledge-solution-generator",
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return buildFallback(pattern);
    }

    return sanitizeSolution(result.stdout);
  } catch {
    return buildFallback(pattern);
  }
}
