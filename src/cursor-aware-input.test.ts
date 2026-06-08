import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("cursor-aware-input rendered value", () => {
  // We verify the source for the NBSP substitution rather than spinning up a
  // real readline against a fake TTY, because the bug surfaces inside
  // @inquirer/core's ScreenManager → wrap-ansi pipeline which is awkward to
  // observe from a unit test.  The source-level guard prevents an accidental
  // revert of the fix (regular space U+0020 would resurface the "cursor
  // behind text" wrap mismatch).
  const source = readFileSync(
    join(__dirname, "cursor-aware-input.ts"),
    "utf-8",
  );

  it("replaces ASCII space with non-breaking space in rendered value", () => {
    // Match pattern: formattedValue.replace(/ /g, " ") — with the NBSP
    // literal embedded.
    const match = source.match(
      /formattedValue\.replace\(\/ \/g,\s*"([\s\S])"\)/,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe(" ");
    expect(match![1].charCodeAt(0)).toBe(0x00a0);
  });

  it("uses the rendered (NBSP) value in the prompt return tuple", () => {
    expect(source).toMatch(/return \[promptLine \+ "\\n" \+ renderedValue, error\]/);
  });

  it("keeps the original value in setValue (so callers receive spaces)", () => {
    // useKeypress handler should still call setValue(rl.line) — the NBSP
    // replacement is render-only, never written back into state.
    expect(source).toMatch(/setValue\(rl\.line\)/);
    expect(source).not.toMatch(/setValue\([^)]*replace\([^)]*\\u00A0/);
  });
});
