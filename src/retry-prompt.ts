import { createInterface } from "node:readline";
import chalk from "chalk";
import { resetTerminalForInput } from "./terminal-reset.js";
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";
import { TaskError } from "./task.js";
import { isTestEnvironment } from "./test-env.js";

export interface RetryPromptOptions {
  /** Name of the task/gate that failed (e.g., "unit tests", "dev agent") */
  taskName: string;
  /** Current attempt number (1-indexed) */
  attempt: number;
  /** Maximum retry attempts configured (0 = disabled) */
  maxRetries: number;
  /** Skip prompts and auto-approve retries */
  autoApprove?: boolean;
  /** Telemetry event details */
  telemetry?: {
    stageName: string;
    agentName: string;
  };
}

/**
 * Shared retry prompt logic for gates and implement loops.
 *
 * Handles three scenarios:
 * 1. Test/non-interactive mode: throw immediately
 * 2. Exceeded max retries: prompt to continue or abort
 * 3. Within retry limit: prompt to retry or abort (unless auto-approved)
 *
 * @returns true if user wants to retry, throws TaskError if user declines or test mode
 */
export async function promptForRetry(options: RetryPromptOptions): Promise<boolean> {
  const { taskName, attempt, maxRetries, autoApprove = false, telemetry } = options;

  // No retries configured - throw immediately
  if (maxRetries === 0) {
    if (telemetry) {
      const chesstrace = getChesstrace();
      if (chesstrace) {
        try {
          chesstrace.emit(Events.ERROR_TASK, {
            type: "TaskError",
            message: `${taskName} failed (retries disabled)`,
            stage: telemetry.stageName,
            agent: telemetry.agentName,
          });
        } catch {
          // Swallow emit errors
        }
      }
    }
    throw new TaskError(`${taskName} failed (retries disabled)`);
  }

  const exceededMax = attempt > maxRetries;

  // In test/non-interactive mode with exceeded retries, throw immediately
  if (exceededMax && (isTestEnvironment() || !process.stdin.isTTY)) {
    if (telemetry) {
      const chesstrace = getChesstrace();
      if (chesstrace) {
        try {
          chesstrace.emit(Events.ERROR_TASK, {
            type: "TaskError",
            message: `${taskName} failed after ${maxRetries} retries`,
            stage: telemetry.stageName,
            agent: telemetry.agentName,
          });
        } catch {
          // Swallow emit errors
        }
      }
    }
    throw new TaskError(`${taskName} failed after ${maxRetries} retries`);
  }

  // Interactive mode with exceeded retries: prompt to continue
  if (exceededMax) {
    resetTerminalForInput();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.yellow(`\n${taskName} failed after ${maxRetries} retries. Continue retrying? (y/n) `),
        resolve,
      );
    });
    rl.close();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      if (telemetry) {
        const chesstrace = getChesstrace();
        if (chesstrace) {
          try {
            chesstrace.emit(Events.ERROR_TASK, {
              type: "TaskError",
              message: `${taskName} failed after ${maxRetries} retries`,
              stage: telemetry.stageName,
              agent: telemetry.agentName,
            });
          } catch {
            // Swallow emit errors
          }
        }
      }
      throw new TaskError(`${taskName} failed - user declined to retry after ${maxRetries} attempts`);
    }
    console.log(chalk.blue("\nContinuing retries...\n"));
    return true;
  }

  // Not exceeded max yet: prompt if not auto-approved
  if (!autoApprove) {
    resetTerminalForInput();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const attemptInfo = maxRetries > 0
      ? `(attempt ${attempt}/${maxRetries})`
      : `(attempt ${attempt})`;
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.yellow(`\n${taskName} failed. Retry? ${attemptInfo} (y/n) `),
        resolve,
      );
    });
    rl.close();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.log(chalk.red("Aborted by user."));
      process.exit(1);
    }
  }

  return true;
}
