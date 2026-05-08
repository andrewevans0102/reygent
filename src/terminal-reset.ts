/**
 * Reset terminal state before user input prompts.
 *
 * After ora spinners finish, terminal cursor/stdin state can be inconsistent.
 * This causes two classes of bugs:
 *   1. Pasted text corrupts the prompt (buffered input from during spinner)
 *   2. Cursor gets "stuck" — typing only moves back and forth on one line
 *      (readline's cursor tracker is desynced from actual terminal state)
 *
 * This function ensures a clean slate for the next readline/inquirer prompt:
 * - SGR text attributes are reset (no color/bold leaking from spinner)
 * - Cursor is visible
 * - stdin is not in raw mode (ora/stdin-discarder may leave it set)
 * - Current line is fully cleared and cursor is at column 0
 */
export function resetTerminalForInput(): void {
  // Reset all SGR text attributes (bold, color, underline, etc.)
  process.stdout.write('\x1b[0m');

  // Show cursor (ora hides it while spinning)
  process.stdout.write('\x1b[?25h');

  // Ensure stdin is not stuck in raw mode — readline/inquirer manage their own
  // raw mode and will break if stdin is already raw when they start
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }

  // Move to column 0 and clear the entire line (not just cursor-to-end)
  process.stdout.write('\r\x1b[2K');
}
