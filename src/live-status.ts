import chalk from "chalk";
import ora from "ora";
import { killAllChildrenProcesses } from "./child-registry.js";
import type { ActivityEvent } from "./providers/types.js";
import { resetTerminalForInput } from "./terminal-reset.js";

export type { ActivityEvent };

const TRACK_LENGTH = 4;

const PAW_POSITIONS = [0, 1, 2, 3, 2, 1];

// Ref-counting for SIGINT handlers to prevent multiple instances racing
let sigintHandlerCount = 0;
let globalSigintHandler: (() => void) | null = null;

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${String(remainMinutes).padStart(2, "0")}m`;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[\d+m/g, "");
}

function truncateToWidth(text: string, maxWidth: number): string {
  const visible = stripAnsi(text);
  if (visible.length <= maxWidth) return text;

  // Truncate visible portion and append ellipsis
  const truncated = visible.slice(0, maxWidth - 1) + "…";

  // Re-apply original color to truncated text
  // Simple heuristic: if original text started with ANSI, wrap truncated in same
  const ansiMatch = text.match(/^(\x1b\[\d+m)/);
  if (ansiMatch) {
    return ansiMatch[1] + truncated + "\x1b[0m";
  }
  return truncated;
}

export function buildAnimationFrame(
  position: number,
  label: string,
  elapsed: string,
  lastActivity?: ActivityEvent,
): string {
  const track = Array.from({ length: TRACK_LENGTH }, (_, i) =>
    i === position ? chalk.yellowBright("🐾") : chalk.gray("·"),
  ).join(" ");

  const mainLine = `${track} ${chalk.blue(label)} ${chalk.gray(elapsed)}`;

  if (lastActivity) {
    const parts = [lastActivity.agent];
    if (lastActivity.tool) parts.push(lastActivity.tool);
    if (lastActivity.detail) parts.push(lastActivity.detail.replace(/[\r\n]+/g, " "));
    const activityText = chalk.cyan(parts.join(" → "));

    // Combine on single line with separator to prevent cursor misalignment
    const terminalWidth = process.stdout.columns || 120;
    const separator = chalk.gray(" | ");
    const combined = `${mainLine}${separator}${activityText}`;

    // Truncate if combined line exceeds terminal width
    return truncateToWidth(combined, terminalWidth - 2);
  }

  return mainLine;
}

export interface LiveStatus {
  onActivity: (event: ActivityEvent) => void;
  succeed: (msg: string) => void;
  fail: (msg: string) => void;
  warn: (msg: string) => void;
  info: (msg: string) => void;
  stop: () => void;
  start: () => void;
}

export function createLiveStatus(label: string): LiveStatus {
  const spinner = ora({
    spinner: { frames: [""], interval: 200 },
    text: "",
    discardStdin: false,
  }).start();

  let frameIndex = 0;
  let lastActivity: ActivityEvent | undefined;
  const startTime = Date.now();

  // Debounce activity events to max 5 Hz (200ms)
  let lastActivityTime = 0;
  const MIN_ACTIVITY_INTERVAL = 200;

  function render() {
    const pos = PAW_POSITIONS[frameIndex % PAW_POSITIONS.length];
    const elapsed = formatElapsed(Date.now() - startTime);
    spinner.text = buildAnimationFrame(pos, label, elapsed, lastActivity);
  }

  render();

  let interval: ReturnType<typeof setInterval> | null = null;

  function createInterval() {
    // Guard against double creation
    if (interval) return interval;

    const id = setInterval(() => {
      frameIndex++;
      render();
    }, 200);
    id.unref();
    return id;
  }

  interval = createInterval();

  function cleanup() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }

    // Decrement ref count and remove global handler if last instance
    if (sigintHandlerCount > 0) {
      sigintHandlerCount--;
      if (sigintHandlerCount === 0 && globalSigintHandler) {
        process.removeListener("SIGINT", globalSigintHandler);
        globalSigintHandler = null;
      }
    }
  }

  function onSigInt() {
    cleanup();
    killAllChildrenProcesses();
    spinner.stop();
    process.exit(130);
  }

  // Install global SIGINT handler with ref-counting
  if (!globalSigintHandler) {
    globalSigintHandler = onSigInt;
    process.on("SIGINT", globalSigintHandler);
  }
  sigintHandlerCount++;

  return {
    onActivity(event: ActivityEvent) {
      // Debounce to prevent spam from high-frequency tools
      const now = Date.now();
      if (now - lastActivityTime < MIN_ACTIVITY_INTERVAL) {
        // Update lastActivity but don't re-render yet
        lastActivity = {
          ...event,
          detail: event.detail?.slice(0, 80), // Defensive truncation
        };
        return;
      }

      lastActivityTime = now;
      lastActivity = {
        ...event,
        detail: event.detail?.slice(0, 80), // Cap detail length
      };
      render();
    },
    succeed(msg: string) {
      cleanup();
      spinner.succeed(msg);
      resetTerminalForInput();
    },
    fail(msg: string) {
      cleanup();
      spinner.fail(msg);
      resetTerminalForInput();
    },
    warn(msg: string) {
      cleanup();
      spinner.warn(msg);
      resetTerminalForInput();
    },
    info(msg: string) {
      cleanup();
      spinner.info(msg);
      resetTerminalForInput();
    },
    stop() {
      cleanup();
      spinner.stop();
      resetTerminalForInput();
    },
    start() {
      spinner.start();
      if (!interval) {
        interval = createInterval();
      }

      // Re-increment ref count when restarting
      if (globalSigintHandler) {
        sigintHandlerCount++;
      } else {
        globalSigintHandler = onSigInt;
        process.on("SIGINT", globalSigintHandler);
        sigintHandlerCount++;
      }

      render();
    },
  };
}
