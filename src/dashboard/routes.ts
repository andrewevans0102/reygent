import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config.js";
import {
  computeFailureAnalysis,
  computeSuccessAnalysis,
  computeCostAnalysis,
  computeAgentAnalysis,
  computeEventTimeline,
  computeRunsSummary,
  checkTelemetryEnabled,
} from "../commands/analyze-data.js";

/**
 * Extract ?since= query param, default "30d"
 */
function getSince(url: URL): string {
  return url.searchParams.get("since") || "30d";
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

function jsonError(res: ServerResponse, message: string, status = 500): void {
  json(res, { error: message }, status);
}

/**
 * Route API requests. Returns true if handled.
 */
export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;

  if (!path.startsWith("/api/")) return false;

  // Verify telemetry enabled on every request
  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);
  } catch (err) {
    jsonError(res, err instanceof Error ? err.message : String(err), 503);
    return true;
  }

  try {
    const since = getSince(url);

    switch (path) {
      case "/api/overview": {
        const [failures, costs, agents] = await Promise.all([
          computeFailureAnalysis({ since }),
          computeCostAnalysis({ since }),
          computeAgentAnalysis({ since }),
        ]);
        json(res, {
          totalRuns: costs.totalRuns,
          successRate: costs.totalRuns > 0
            ? costs.successfulRuns / costs.totalRuns
            : 0,
          totalCost: costs.totalCost,
          activeAgents: agents.agents.length,
          totalErrors: failures.totalErrors,
          days: costs.days,
        });
        return true;
      }

      case "/api/failures": {
        const result = await computeFailureAnalysis({ since });
        json(res, result);
        return true;
      }

      case "/api/success": {
        const result = await computeSuccessAnalysis({ since });
        json(res, result);
        return true;
      }

      case "/api/costs": {
        const result = await computeCostAnalysis({ since });
        json(res, result);
        return true;
      }

      case "/api/agents": {
        const result = await computeAgentAnalysis({ since });
        json(res, result);
        return true;
      }

      case "/api/timeline": {
        const result = await computeEventTimeline({ since });
        json(res, result);
        return true;
      }

      case "/api/runs": {
        const result = await computeRunsSummary({ since, limit: 50 });
        json(res, result);
        return true;
      }

      default:
        jsonError(res, "Not found", 404);
        return true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonError(res, msg);
    return true;
  }
}
