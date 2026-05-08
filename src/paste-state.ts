/**
 * Shared paste state between pasteable-input and cursor-aware-input.
 *
 * pasteable-input accumulates pasted text here (bypassing readline).
 * cursor-aware-input checks `pending` on each keypress — when true,
 * it injects the text into rl.line directly and triggers one render.
 *
 * Separate module avoids circular dependency between the two.
 */
export const pasteState = {
  /** True when accumulated paste text is ready to be consumed. */
  pending: false,
  /** Accumulated paste content (newlines replaced with spaces). */
  text: "",
};
