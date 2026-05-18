import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DashboardSnapshot } from "./collect-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate standalone HTML dashboard file
 */
export async function generateHTML(
  data: DashboardSnapshot,
  outputPath: string
): Promise<void> {
  // Read template
  const templatePath = join(__dirname, "template.html");
  const template = await readFile(templatePath, "utf-8");

  // Serialize data to JSON
  const dataJson = JSON.stringify(data, null, 2);

  // Inject data into template
  const html = template.replace("__DATA_PLACEHOLDER__", dataJson);

  // Write output
  await writeFile(outputPath, html, "utf-8");
}
