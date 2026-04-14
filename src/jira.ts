import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { extractJSON } from "./planner.js";
import { JiraSpecPayload, SpecError } from "./spec.js";

const JIRA_KEY_PATTERN = /^[A-Z]+-\d+$/;

export function isJiraKey(input: string): boolean {
  return JIRA_KEY_PATTERN.test(input);
}

export async function readJiraSpec(issueKey: string): Promise<JiraSpecPayload> {
  const mcpUrl = process.env.JIRA_MCP_URL;

  if (!mcpUrl) {
    throw new SpecError(
      `JIRA_MCP_URL is not configured.\n\n` +
        `Add the following to your .env file:\n\n` +
        `  JIRA_MCP_URL=https://your-jira-mcp-server.example.com/sse\n\n` +
        `This should point to your Jira MCP server's SSE endpoint.`,
    );
  }

  const transport = new SSEClientTransport(new URL(mcpUrl));
  const client = new Client({ name: "reygent", version: "0.1.0" });

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: "get_issue",
      arguments: { issueIdOrKey: issueKey },
    });

    if (result.isError) {
      const errorText =
        result.content
          ?.filter(
            (c): c is { type: "text"; text: string } => c.type === "text",
          )
          .map((c) => c.text)
          .join("\n") || "Unknown error";
      throw new SpecError(
        `Jira API error for ${issueKey}: ${errorText}`,
      );
    }

    const textBlocks =
      result.content?.filter(
        (c): c is { type: "text"; text: string } => c.type === "text",
      ) || [];

    if (textBlocks.length === 0) {
      throw new SpecError(
        `No content returned from Jira MCP server for ${issueKey}`,
      );
    }

    const raw = textBlocks.map((c) => c.text).join("\n");

    let title: string;
    let content: string;

    try {
      const parsed = JSON.parse(extractJSON(raw));
      title = parsed.summary || parsed.title || issueKey;
      const description = parsed.description || "";
      const acceptanceCriteria =
        parsed.acceptanceCriteria ||
        parsed.acceptance_criteria ||
        parsed.customfield_10001 ||
        "";

      const parts = [`# ${title}`, description];
      if (acceptanceCriteria) {
        parts.push(`## Acceptance Criteria\n\n${acceptanceCriteria}`);
      }
      content = parts.join("\n\n");
    } catch {
      // Response is plain text / markdown, not JSON
      content = raw;
      const headingMatch = raw.match(/^# (.+)$/m);
      title = headingMatch ? headingMatch[1].trim() : issueKey;
    }

    return { source: "jira", issueKey, title, content };
  } catch (err) {
    if (err instanceof SpecError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecError(`Failed to connect to Jira MCP server: ${message}`);
  } finally {
    await client.close().catch(() => {});
  }
}
