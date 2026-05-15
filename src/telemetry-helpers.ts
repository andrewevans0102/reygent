import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";
import { isDebug } from "./debug.js";

export interface ErrorTaskOptions {
  agent?: string;
  errorMessage?: string;
  apiErrorStatus?: number;
}

/**
 * Emit ERROR_TASK event to chesstrace if available.
 * Common pattern extracted from generate-spec.ts, planner.ts, implement.ts, etc.
 */
export function emitErrorTask(
  message: string,
  stage: string,
  options?: ErrorTaskOptions,
): void {
  const chesstrace = getChesstrace();
  if (chesstrace) {
    try {
      chesstrace.emit(Events.ERROR_TASK, {
        type: "TaskError",
        message,
        stage,
        ...(options?.agent && { agent: options.agent }),
        ...(options?.errorMessage && { errorMessage: options.errorMessage }),
        ...(options?.apiErrorStatus && { apiErrorStatus: options.apiErrorStatus }),
      });
    } catch (err) {
      // Swallow emit errors to prevent telemetry from breaking main logic
      // Log to stderr in debug mode to help diagnose broken telemetry backends
      if (isDebug()) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[DEBUG] Telemetry emit failed (ERROR_TASK): ${errMsg}`);
      }
    }
  }
}
