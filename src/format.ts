/**
 * Word-wrap text to fit terminal width, preserving indentation on continuation lines.
 *
 * @param text    Plain text to wrap (no ANSI codes)
 * @param indent  Number of columns reserved for the prefix on continuation lines
 * @param maxWidth  Terminal width (columns)
 */
export function wrapText(text: string, indent: number, maxWidth: number): string {
  const available = maxWidth - indent;
  if (available <= 20 || text.length <= available) return text;

  const words = text.split(" ");
  const wrappedLines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= available) {
      currentLine += " " + word;
    } else {
      wrappedLines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) wrappedLines.push(currentLine);

  const pad = " ".repeat(indent);
  return wrappedLines.join("\n" + pad);
}
