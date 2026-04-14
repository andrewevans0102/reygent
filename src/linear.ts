import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { extractJSON } from "./planner.js";
import { LinearSpecPayload, SpecError } from "./spec.js";

const LINEAR_URL_PATTERN =
  /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/;

export function isLinearUrl(input: string): boolean {
  return LINEAR_URL_PATTERN.test(input);
}

export function extractLinearId(url: string): string {
  const match = url.match(LINEAR_URL_PATTERN);
  if (!match) {
    throw new SpecError(`Could not extract issue ID from Linear URL: ${url}`);
  }
  return match[1];
}

export async function readLinearSpec(
  issueId: string,
): Promise<LinearSpecPayload> {
  const mcpUrl = process.env.LINEAR_MCP_URL;

  if (!mcpUrl) {
    throw new SpecError(
      `LINEAR_MCP_URL is not configured.\n\n` +
        `Add the following to your .env file:\n\n` +
        `  LINEAR_MCP_URL=https://your-linear-mcp-server.example.com/sse\n\n` +
        `This should point to your Linear MCP server's SSE endpoint.`,
    );
  }

  const transport = new SSEClientTransport(new URL(mcpUrl));
  const client = new Client({ name: "reygent", version: "0.1.0" });

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: "get_issue",
      arguments: { id: issueId },
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
        `Linear API error for ${issueId}: ${errorText}`,
      );
    }

    const textBlocks =
      result.content?.filter(
        (c): c is { type: "text"; text: string } => c.type === "text",
      ) || [];

    if (textBlocks.length === 0) {
      throw new SpecError(
        `No content returned from Linear MCP server for ${issueId}`,
      );
    }

    const raw = textBlocks.map((c) => c.text).join("\n");

    let title: string;
    let content: string;

    try {
      const parsed = JSON.parse(extractJSON(raw));
      title = parsed.title || parsed.summary || issueId;
      const description = parsed.description || "";

      const parts = [`# ${title}`, description];

      // Include sub-issues if present
      const subIssues =
        parsed.subIssues || parsed.children || parsed.sub_issues || [];
      if (Array.isArray(subIssues) && subIssues.length > 0) {
        const subSection = subIssues
          .map((sub: { title?: string; description?: string; id?: string }) => {
            const subTitle = sub.title || sub.id || "Untitled";
            const subDesc = sub.description ? `\n${sub.description}` : "";
            return `- **${subTitle}**${subDesc}`;
          })
          .join("\n");
        parts.push(`## Sub-issues\n\n${subSection}`);
      }

      content = parts.join("\n\n");
    } catch {
      content = raw;
      const headingMatch = raw.match(/^# (.+)$/m);
      title = headingMatch ? headingMatch[1].trim() : issueId;
    }

    return { source: "linear", issueId, title, content };
  } catch (err) {
    if (err instanceof SpecError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecError(
      `Failed to connect to Linear MCP server: ${message}`,
    );
  } finally {
    await client.close().catch(() => {});
  }
}
