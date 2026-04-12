import { readSpec, SpecError } from "../spec.js";
import { isJiraKey, readJiraSpec } from "../jira.js";
import { isLinearUrl, extractLinearId, readLinearSpec } from "../linear.js";
import { loadEnvFile } from "../env.js";

const ISSUE_KEY_PATTERN = /^[A-Z]+-\d+$/;

export async function specCommand(source: string): Promise<void> {
  try {
    if (isLinearUrl(source)) {
      loadEnvFile();
      const issueId = extractLinearId(source);
      const payload = await readLinearSpec(issueId);
      console.log(JSON.stringify(payload, null, 2));
    } else if (ISSUE_KEY_PATTERN.test(source)) {
      loadEnvFile();
      const hasLinear = !!process.env.LINEAR_MCP_URL;
      const hasJira = !!process.env.JIRA_MCP_URL;

      if (hasLinear && !hasJira) {
        const payload = await readLinearSpec(source);
        console.log(JSON.stringify(payload, null, 2));
      } else if (hasJira) {
        const payload = await readJiraSpec(source);
        console.log(JSON.stringify(payload, null, 2));
      } else {
        throw new SpecError(
          `No issue tracker configured for "${source}".\n\n` +
            `Add one of the following to your .env file:\n\n` +
            `  LINEAR_MCP_URL=https://your-linear-mcp-server.example.com/sse\n` +
            `  JIRA_MCP_URL=https://your-jira-mcp-server.example.com/sse`,
        );
      }
    } else {
      const payload = readSpec(source);
      console.log(JSON.stringify(payload, null, 2));
    }
  } catch (err) {
    if (err instanceof SpecError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
