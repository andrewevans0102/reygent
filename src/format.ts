/** Strip ANSI escape codes for accurate visual length measurement. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Word-wrap text to fit terminal width, preserving indentation on continuation lines.
 *
 * @param text    Text to wrap (may contain ANSI codes)
 * @param indent  Number of columns reserved for the prefix on continuation lines
 * @param maxWidth  Terminal width (columns)
 * @param continuationPrefix  Optional string to prepend to continuation lines instead of spaces
 */
export function wrapText(text: string, indent: number, maxWidth: number, continuationPrefix?: string): string {
  const available = maxWidth - indent;
  if (available <= 20 || stripAnsi(text).length <= available) return text;

  const words = text.split(" ");
  const wrappedLines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (stripAnsi(currentLine).length + 1 + stripAnsi(word).length <= available) {
      currentLine += " " + word;
    } else {
      wrappedLines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) wrappedLines.push(currentLine);

  const pad = continuationPrefix ?? " ".repeat(indent);
  return wrappedLines.join("\n" + pad);
}
