/**
 * Reset terminal state before user input prompts.
 *
 * After ora spinners finish, terminal cursor state can be inconsistent.
 * When users paste multi-line text into prompts (inquirer or readline),
 * the readline handler may break, causing cursor lock issues.
 *
 * This function ensures:
 * - Cursor is visible
 * - Cursor returns to start of line
 * - Current line is cleared
 */
export function resetTerminalForInput(): void {
  process.stdout.write('\x1b[?25h'); // Show cursor
  process.stdout.write('\r');         // Return to start of line
  process.stdout.write('\x1b[K');     // Clear line
}
