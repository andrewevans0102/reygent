/**
 * Custom input prompt based on @inquirer/input v5.0.11.
 *
 * Fixes a cursor-tracking bug in @inquirer/core's ScreenManager:
 * `checkCursorPos()` only corrects the column on keypress, never the row.
 * When arrow keys / Home / End don't change `rl.line`, `useState` skips
 * the re-render and the cursor stays on the wrong visual row.
 *
 * Fix: track `rl.cursor` in a separate `useState`. When cursor position
 * changes, `useState` sees a new value → triggers `handleChange()` →
 * full `render()` → correct row+column positioning.
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
import type { PartialDeep } from "@inquirer/type";

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

export default createPrompt<string, InputConfig>((config, done) => {
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
      setValue(rl.line);
      setError(undefined);
      setCursorPos(rl.cursor); // force re-render on cursor movement
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

  return [
    [prefix, message, defaultStr, formattedValue]
      .filter((v) => v !== undefined)
      .join(" "),
    error,
  ];
});
