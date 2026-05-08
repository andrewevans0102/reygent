import cursorAwareInput from "./cursor-aware-input.js";
import { pasteState } from "./paste-state.js";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_BRACKET_ON = "\x1b[?2004h";
const PASTE_BRACKET_OFF = "\x1b[?2004l";

/**
 * Paste-aware wrapper around cursor-aware input.
 *
 * Problem: readline treats every \r / \n as Enter (submit), and each
 * character triggers a separate keypress → re-render cycle.  Pasting
 * text causes immediate submission (trailing newline) and visible
 * cursor jumping (N renders for N characters).
 *
 * Solution: enable terminal *bracketed paste mode* so the terminal
 * wraps pasted content in \x1b[200~ … \x1b[201~ markers.  We patch
 * stdin.emit to intercept 'data' events.  Instead of forwarding pasted
 * characters to readline (which would process them one-by-one), we
 * accumulate the text in a shared pasteState object.  After the paste
 * ends we emit a single synthetic keypress; cursor-aware-input detects
 * the pending paste, injects the text into rl.line directly, and
 * triggers exactly one render.  Zero intermediate redraws.
 */
export async function pasteableInput(
  config: Parameters<typeof cursorAwareInput>[0],
  context?: Parameters<typeof cursorAwareInput>[1],
): Promise<string> {
  const stdin = process.stdin;
  let inPaste = false;
  let justPasted = false; // stays true for one chunk after paste ends

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
      const wasJustPasted = justPasted;
      justPasted = false;

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
        justPasted = true;
      }

      // --- Paste content: accumulate, don't forward to readline ---
      if (wasPasting || startIdx !== -1) {
        str = str.replace(/\r?\n|\r/g, " ");
        pasteState.text += str;

        if (!inPaste) {
          // Paste complete — trim trailing whitespace from accumulated
          // text (clipboard often appends a newline → trailing space).
          pasteState.text = pasteState.text.trimEnd();
          pasteState.pending = true;

          // Emit synthetic keypress so cursor-aware-input's useKeypress
          // fires once, picks up the pending text, and renders.
          // Empty string → readline's _ttyWrite is a no-op.
          // checkCursorPos sees no change (rl.line hasn't changed yet).
          originalEmit.apply(this, ["keypress", "", { name: "" }]);
        }
        return false; // swallow data event — don't send to readline
      }

      // --- Straggling newline after paste-end (arrives in next chunk) ---
      if (wasJustPasted) {
        if (/^(\r?\n|\r)+$/.test(str)) {
          return false; // swallow pure newline stragglers
        }
        // Non-newline content right after paste — fall through to normal
      }

      // --- Regular keystroke: forward unchanged ---
      if (str.length === 0) {
        return false;
      }
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
    justPasted = false;
    pasteState.pending = false;
    pasteState.text = "";
  }
}
