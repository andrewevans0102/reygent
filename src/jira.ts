import { JiraSpecPayload, SpecError } from "./spec.js";

const JIRA_KEY_PATTERN = /^[A-Z]+-\d+$/;

export function isJiraKey(input: string): boolean {
  return JIRA_KEY_PATTERN.test(input);
}

interface JiraIssueFields {
  summary: string;
  description?: string | { content: unknown[] };
  [key: string]: unknown;
}

interface JiraIssueResponse {
  key: string;
  fields: JiraIssueFields;
}

function parseADF(adf: { content: unknown[] }): string {
  // Convert Atlassian Document Format to plain text
  const lines: string[] = [];

  function walk(node: any): void {
    if (!node) return;

    if (node.type === "text") {
      lines.push(node.text || "");
    } else if (node.type === "paragraph") {
      const textContent = node.content
        ?.map((n: any) => n.text || "")
        .join("") || "";
      if (textContent.trim()) lines.push(textContent);
    } else if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  }

  if (Array.isArray(adf.content)) {
    adf.content.forEach(walk);
  }

  return lines.join("\n\n");
}

export async function readJiraSpec(issueKey: string): Promise<JiraSpecPayload> {
  const jiraUrl = process.env.JIRA_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraToken = process.env.JIRA_API_TOKEN;

  if (!jiraUrl || !jiraEmail || !jiraToken) {
    throw new SpecError(
      `Jira API credentials not configured.\n\n` +
        `Add the following to your .env file:\n\n` +
        `  JIRA_URL=https://your-company.atlassian.net\n` +
        `  JIRA_EMAIL=you@company.com\n` +
        `  JIRA_API_TOKEN=your-api-token\n\n` +
        `Get an API token at: https://id.atlassian.com/manage-profile/security/api-tokens`,
    );
  }

  const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString("base64");
  const url = `${jiraUrl}/rest/api/3/issue/${issueKey}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new SpecError(
        `Jira API error (${response.status}): ${errorText}`,
      );
    }

    const data = await response.json() as JiraIssueResponse;
    const title = data.fields.summary || issueKey;

    let description = "";
    if (data.fields.description) {
      if (typeof data.fields.description === "string") {
        description = data.fields.description;
      } else if (typeof data.fields.description === "object" && "content" in data.fields.description) {
        description = parseADF(data.fields.description as { content: unknown[] });
      }
    }

    // Check common custom field names for acceptance criteria
    const acceptanceCriteria =
      (data.fields.acceptanceCriteria as string | undefined) ||
      (data.fields.acceptance_criteria as string | undefined) ||
      (data.fields.customfield_10001 as string | undefined) ||
      "";

    const parts = [`# ${title}`, description];
    if (acceptanceCriteria) {
      parts.push(`## Acceptance Criteria\n\n${acceptanceCriteria}`);
    }

    const content = parts.filter(p => p.trim()).join("\n\n");

    return { source: "jira", issueKey, title, content };
  } catch (err) {
    if (err instanceof SpecError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecError(`Failed to fetch Jira issue: ${message}`);
  }
}
