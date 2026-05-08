import { PassThrough } from "node:stream";
import { input as inquirerInput } from "@inquirer/prompts";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_BRACKET_ON = "\x1b[?2004h";
const PASTE_BRACKET_OFF = "\x1b[?2004l";

/**
 * Paste-aware wrapper around @inquirer/prompts `input()`.
 *
 * Problem: @inquirer/input treats every \r / \n as Enter (submit).
 * When text is pasted from clipboard it almost always contains a trailing
 * newline, causing the prompt to submit immediately.
 *
 * Solution: enable terminal *bracketed paste mode* so the terminal wraps
 * pasted content in \x1b[200~ … \x1b[201~ markers.  A proxy stream sits
 * between real stdin and readline, stripping the markers and replacing
 * newlines inside pasted content with spaces so readline never sees an
 * Enter keypress during a paste.
 */
export async function pasteableInput(
  config: Parameters<typeof inquirerInput>[0],
  context?: Parameters<typeof inquirerInput>[1],
): Promise<string> {
  const stdin = process.stdin;

  // Proxy stream with TTY surface so readline behaves normally
  const proxy = new PassThrough();
  Object.defineProperty(proxy, "isTTY", {
    value: stdin.isTTY,
    configurable: true,
  });
  Object.defineProperty(proxy, "setRawMode", {
    value: (mode: boolean) => {
      if (stdin.isTTY) stdin.setRawMode(mode);
      return proxy;
    },
    configurable: true,
  });

  let inPaste = false;

  const onData = (chunk: Buffer) => {
    let str = chunk.toString("utf-8");
    const wasPasting = inPaste;

    // Detect and strip paste-start marker
    const startIdx = str.indexOf(PASTE_START);
    if (startIdx !== -1) {
      inPaste = true;
      str = str.slice(0, startIdx) + str.slice(startIdx + PASTE_START.length);
    }

    // Detect and strip paste-end marker
    const endIdx = str.indexOf(PASTE_END);
    if (endIdx !== -1) {
      str = str.slice(0, endIdx) + str.slice(endIdx + PASTE_END.length);
      inPaste = false;
    }

    // Replace newlines with spaces inside pasted content
    if (wasPasting || startIdx !== -1) {
      str = str.replace(/\r?\n|\r/g, " ");
    }

    if (str.length > 0) {
      proxy.write(str);
    }
  };

  // Enable bracketed paste and wire stdin → proxy
  if (stdin.isTTY) {
    process.stdout.write(PASTE_BRACKET_ON);
  }
  stdin.on("data", onData);
  stdin.resume();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await inquirerInput(config, { ...context, input: proxy as any });
  } finally {
    stdin.removeListener("data", onData);
    if (stdin.isTTY) {
      process.stdout.write(PASTE_BRACKET_OFF);
    }
    inPaste = false;
    proxy.end();
  }
}
