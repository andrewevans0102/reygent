import chalk from "chalk";
import ora from "ora";
import { killAllChildren } from "./child-registry.js";
import type { ActivityEvent } from "./providers/types.js";

export type { ActivityEvent };

const TRACK_LENGTH = 4;

const PAW_POSITIONS = [0, 1, 2, 3, 2, 1];

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

export function buildAnimationFrame(
  position: number,
  label: string,
  elapsed: string,
  lastActivity?: ActivityEvent,
): string {
  const track = Array.from({ length: TRACK_LENGTH }, (_, i) =>
    i === position ? chalk.yellowBright("🐾") : chalk.gray("·"),
  ).join(" ");

  let activityStr = "";
  if (lastActivity) {
    const parts = [lastActivity.agent];
    if (lastActivity.tool) parts.push(lastActivity.tool);
    if (lastActivity.detail) parts.push(lastActivity.detail);
    activityStr = ` ${chalk.gray("│")} ${chalk.cyan(parts.join(" → "))}`;
  }

  return `${track} ${chalk.blue(label)} ${chalk.gray(elapsed)}${activityStr}`;
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

  function render() {
    const pos = PAW_POSITIONS[frameIndex % PAW_POSITIONS.length];
    const elapsed = formatElapsed(Date.now() - startTime);
    spinner.text = buildAnimationFrame(pos, label, elapsed, lastActivity);
  }

  render();

  function createInterval() {
    const id = setInterval(() => {
      frameIndex++;
      render();
    }, 200);
    id.unref();
    return id;
  }

  let interval: ReturnType<typeof setInterval> | null = createInterval();

  function cleanup() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    process.removeListener("SIGINT", onSigInt);
  }

  function onSigInt() {
    cleanup();
    killAllChildren();
    spinner.stop();
    process.exit(130);
  }

  process.on("SIGINT", onSigInt);

  return {
    onActivity(event: ActivityEvent) {
      lastActivity = event;
      render();
    },
    succeed(msg: string) {
      cleanup();
      spinner.succeed(msg);
    },
    fail(msg: string) {
      cleanup();
      spinner.fail(msg);
    },
    warn(msg: string) {
      cleanup();
      spinner.warn(msg);
    },
    info(msg: string) {
      cleanup();
      spinner.info(msg);
    },
    stop() {
      cleanup();
      spinner.stop();
    },
    start() {
      spinner.start();
      if (!interval) {
        interval = createInterval();
      }
      process.removeListener("SIGINT", onSigInt);
      process.on("SIGINT", onSigInt);
      render();
    },
  };
}
