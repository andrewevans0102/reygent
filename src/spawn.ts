import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { TaskError } from "./task.js";

export interface SpawnResult {
  stdout: string;
  exitCode: number;
}

interface StreamAssistantMessage {
  type: "assistant";
  message: {
    content: Array<
      | { type: "tool_use"; name: string; input: Record<string, unknown> }
      | { type: "text"; text: string }
    >;
  };
}

interface StreamResultMessage {
  type: "result";
  subtype: string;
  result: string;
}

type StreamEvent = StreamAssistantMessage | StreamResultMessage | { type: string };

function formatToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return typeof input.file_path === "string" ? input.file_path : "";
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
    }
    case "Glob":
      return typeof input.pattern === "string" ? input.pattern : "";
    case "Grep":
      return typeof input.pattern === "string" ? `/${input.pattern}/` : "";
    default:
      return "";
  }
}

export interface SpawnOptions {
  quiet?: boolean;
  autoApprove?: boolean;
}

export function spawnAgentStream(
  name: string,
  prompt: string,
  timeoutMs: number,
  options?: SpawnOptions,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    if (options?.autoApprove) {
      args.push("--allowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep");
    }

    const stdinMode = options?.autoApprove === false ? "inherit" : "ignore";
    const child = spawn("claude", args, { stdio: [stdinMode, "pipe", "pipe"] });

    let resultText = "";
    const textChunks: string[] = [];

    const timeout = setTimeout(() => {
      child.kill();
      reject(new TaskError(`${name}: timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let stdoutEnded = false;
    let stderrEnded = false;
    let processExitCode: number | null = null;

    const maybeResolve = () => {
      if (stdoutEnded && stderrEnded && processExitCode !== null) {
        clearTimeout(timeout);
        const stdout = resultText || textChunks.join("\n");
        resolve({ stdout, exitCode: processExitCode });
      }
    };

    const stdoutRL = createInterface({ input: child.stdout! });
    stdoutRL.on("line", (line) => {
      if (!line.trim()) return;

      let event: StreamEvent;
      try {
        event = JSON.parse(line) as StreamEvent;
      } catch {
        // Non-JSON line — pass through
        console.log(chalk.gray(`[${name}]`), line);
        return;
      }

      if (event.type === "assistant") {
        const msg = event as StreamAssistantMessage;
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            const detail = formatToolDetail(block.name, block.input);
            const suffix = detail ? ` ${chalk.gray(detail)}` : "";
            process.stderr.write(`${chalk.gray(`[${name}]`)} ${chalk.cyan("→")} ${chalk.blue(block.name)}${suffix}\n`);
          } else if (block.type === "text") {
            if (!options?.quiet) {
              console.log(chalk.gray(`[${name}]`), block.text);
            }
            textChunks.push(block.text);
          }
        }
      } else if (event.type === "result") {
        const msg = event as StreamResultMessage;
        resultText = msg.result;
      }
    });
    stdoutRL.on("close", () => {
      stdoutEnded = true;
      maybeResolve();
    });

    const stderrRL = createInterface({ input: child.stderr! });
    stderrRL.on("line", (line) => {
      process.stderr.write(`${chalk.gray(`[${name}]`)} ${line}\n`);
    });
    stderrRL.on("close", () => {
      stderrEnded = true;
      maybeResolve();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new TaskError(`${name}: failed to spawn — ${err.message}`));
    });

    child.on("close", (code) => {
      processExitCode = code ?? 1;
      maybeResolve();
    });
  });
}
