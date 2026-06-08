/**
 * Custom input prompt based on @inquirer/input v5.0.11.
 *
 * Fixes three cursor-tracking bugs in @inquirer/core's ScreenManager:
 *
 * 1. `checkCursorPos()` only corrects the column on keypress, never the row.
 *    When arrow keys / Home / End don't change `rl.line`, `useState` skips
 *    the re-render and the cursor stays on the wrong visual row.
 *    Fix: track `rl.cursor` in a separate `useState`. When cursor position
 *    changes, `useState` sees a new value → triggers `handleChange()` →
 *    full `render()` → correct row+column positioning.
 *
 * 2. When prompt + input exceeds terminal width, `breakLines()` uses
 *    `wrapAnsi` which does **word-level** wrapping (breaking at spaces).
 *    But readline's `getCursorPos()` calculates column via simple
 *    `total % columns` (character-level division). After word-wrapping,
 *    the visual column doesn't match readline's calculated column,
 *    causing the cursor to appear at the wrong position (mid-word).
 *    Fix: render user input on a separate line from the prompt message
 *    during active editing, so both readline and wrapAnsi start from
 *    column 0 and agree on wrap positions.
 *
 * 3. When the input *itself* wraps to a second visual line (typing past
 *    terminal width), the same word-wrap vs char-wrap mismatch resurfaces.
 *    wrap-ansi breaks at the last space ≤ width (e.g., col 78), while
 *    readline tracks the cursor as `total % width` (e.g., col 80).  The
 *    visible cursor then lands ~2 cols *behind* the typed text on every
 *    wrapped line.
 *    Fix: in the *rendered* value only, replace ASCII space U+0020 with
 *    non-breaking space U+00A0.  wrap-ansi splits words on U+0020 only
 *    (`string.split(' ')`), so with no break opportunities it falls
 *    through to `hard: true` and breaks at exactly `width` chars —
 *    matching readline.  NBSP renders identically to space in every
 *    monospace font; `rl.line` is untouched so the returned value still
 *    contains the original spaces.
 *
 * Also handles paste injection: when pasteState.pending is true,
 * the accumulated text is inserted directly into rl.line (bypassing
 * readline's per-character processing) and a single render fires.
 */
import {
  createPrompt,
  useState,
  useKeypress,
  useEffect,
  usePrefix,
  isBackspaceKey,
  isEnterKey,
  isTabKey,
  makeTheme,
  type Theme,
} from "@inquirer/core";
import type { PartialDeep, Prompt } from "@inquirer/type";
import { pasteState } from "./paste-state.js";

type InputTheme = {
  validationFailureMode: "keep" | "clear";
};

type InputConfig = {
  message: string;
  default?: string;
  prefill?: "tab" | "editable";
  required?: boolean;
  transformer?: (value: string, opts: { isFinal: boolean }) => string;
  validate?: (value: string) => boolean | string | Promise<string | boolean>;
  theme?: PartialDeep<Theme<InputTheme>>;
  pattern?: RegExp;
  patternError?: string;
};

const inputTheme: InputTheme = {
  validationFailureMode: "keep",
};

const cursorAwareInput: Prompt<string, InputConfig> = createPrompt<string, InputConfig>((config, done) => {
  const { prefill = "tab" } = config;
  const theme = makeTheme(inputTheme, config.theme);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [defaultValue, setDefaultValue] = useState<string>(
    String(config.default ?? ""),
  );
  const [errorMsg, setError] = useState<string | undefined>();
  const [value, setValue] = useState<string>("");
  const [, setCursorPos] = useState<number>(0);
  const prefix = usePrefix({ status, theme });

  async function validate(val: string): Promise<true | string> {
    const { required, pattern, patternError = "Invalid input" } = config;
    if (required && !val) {
      return "You must provide a value";
    }
    if (pattern && !pattern.test(val)) {
      return patternError;
    }
    if (typeof config.validate === "function") {
      return (await config.validate(val)) || "You must provide a valid value";
    }
    return true;
  }

  useKeypress(async (key, rl) => {
    if (status !== "idle") {
      return;
    }

    // --- Paste injection: insert accumulated text into rl.line directly ---
    if (pasteState.pending) {
      const text = pasteState.text;
      pasteState.pending = false;
      pasteState.text = "";

      // Insert at current cursor position
      // InquirerReadline omits `cursor` from its type but readline.Interface exposes it.
      const rlAny = rl as typeof rl & { cursor: number; line: string };
      const before = rlAny.line.slice(0, rlAny.cursor);
      const after = rlAny.line.slice(rlAny.cursor);
      rlAny.line = before + text + after;
      rlAny.cursor = before.length + text.length;

      setDefaultValue("");
      setValue(rlAny.line);
      setError(undefined);
      setCursorPos(rlAny.cursor);
      return;
    }

    if (isEnterKey(key)) {
      const answer = value || defaultValue;
      setStatus("loading");
      const isValid = await validate(answer);
      if (isValid === true) {
        setValue(answer);
        setStatus("done");
        done(answer);
      } else {
        if (theme.validationFailureMode === "clear") {
          setValue("");
        } else {
          rl.write(value);
        }
        setError(isValid);
        setStatus("idle");
      }
    } else if (isBackspaceKey(key) && !value) {
      setDefaultValue("");
    } else if (isTabKey(key) && !value) {
      setDefaultValue("");
      rl.clearLine(0);
      rl.write(defaultValue);
      setValue(defaultValue);
    } else {
      const rlAny = rl as typeof rl & { cursor: number };
      setValue(rl.line);
      setError(undefined);
      setCursorPos(rlAny.cursor); // force re-render on cursor movement
    }
  });

  useEffect((rl) => {
    if (prefill === "editable" && defaultValue) {
      rl.write(defaultValue);
      setValue(defaultValue);
    }
  }, []);

  const message = theme.style.message(config.message, status);
  let formattedValue = value;
  if (typeof config.transformer === "function") {
    formattedValue = config.transformer(value, { isFinal: status === "done" });
  } else if (status === "done") {
    formattedValue = theme.style.answer(value);
  }

  let defaultStr: string | undefined;
  if (defaultValue && status !== "done" && !value) {
    defaultStr = theme.style.defaultAnswer(defaultValue);
  }

  let error = "";
  if (errorMsg) {
    error = theme.style.error(errorMsg);
  }

  // When status is "done", render everything on one line (standard @inquirer
  // completion display — no cursor interaction, so wrapping is harmless).
  if (status === "done") {
    return [
      [prefix, message, defaultStr, formattedValue]
        .filter((v) => v !== undefined)
        .join(" "),
      error,
    ];
  }

  // During active editing, render input on its own line.  This prevents
  // a mismatch between wrapAnsi's word-level wrapping (used by breakLines)
  // and readline's character-count cursor positioning (getCursorPos uses
  // total % columns).  With input starting at column 0, both agree on
  // where line breaks occur — see bug #2 in the file header.
  const promptLine = [prefix, message, defaultStr]
    .filter((v) => v !== undefined)
    .join(" ");

  // Force char-level wrapping of the input by neutralising word breaks.
  // See bug #3 in the file header.  Only applied to the rendered string —
  // `value`/`rl.line` keeps the original spaces, so the resolved answer
  // returned to callers is unchanged.
  const renderedValue = formattedValue.replace(/ /g, " ");

  return [promptLine + "\n" + renderedValue, error];
});

export default cursorAwareInput;
