import cursorAwareInput from "./cursor-aware-input.js";

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
 * pasted content in \x1b[200~ … \x1b[201~ markers.  We temporarily patch
 * stdin.emit to intercept 'data' events, stripping the markers and replacing
 * newlines inside pasted content with spaces so readline never sees an
 * Enter keypress during a paste.
 *
 * Previous approach used a PassThrough proxy stream, but this broke word-wrap
 * cursor tracking: @inquirer/prompts' ScreenManager relies on readline having
 * accurate terminal dimensions via the real stdin/stdout chain.  The proxy
 * stream lacked proper TTY properties (columns, rows, resize events), causing
 * readline's getCursorPos() to desync from the actual terminal when text
 * wrapped past the terminal width.
 */
export async function pasteableInput(
  config: Parameters<typeof cursorAwareInput>[0],
  context?: Parameters<typeof cursorAwareInput>[1],
): Promise<string> {
  const stdin = process.stdin;
  let inPaste = false;

  // Enable bracketed paste mode
  if (stdin.isTTY) {
    process.stdout.write(PASTE_BRACKET_ON);
  }

  // Temporarily patch stdin.emit to intercept 'data' events for paste
  // handling while preserving all TTY properties for readline/inquirer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalEmit = stdin.emit as (...args: any[]) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function patchedEmit(this: typeof stdin, event: string | symbol, ...args: any[]): boolean {
    if (event === "data") {
      let chunk = args[0];
      let str: string = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
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

      // Strip only trailing newline inside pasted content to prevent auto-submit
      // Preserve internal newlines for multi-line paste formatting
      if (wasPasting || startIdx !== -1) {
        str = str.replace(/(\r?\n|\r)$/, "");
      }

      // Drop empty chunks after marker stripping
      if (str.length === 0) {
        return false;
      }

      // Forward modified data as a Buffer (what readline expects)
      args[0] = Buffer.from(str, "utf-8");
    }
    return originalEmit.apply(this, [event, ...args]);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stdin.emit = patchedEmit as any;

  try {
    return await cursorAwareInput(config, context);
  } finally {
    stdin.emit = originalEmit;
    if (stdin.isTTY) {
      process.stdout.write(PASTE_BRACKET_OFF);
    }
    inPaste = false;
  }
}
