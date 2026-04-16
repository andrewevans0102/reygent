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

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  children?: {
    nodes: Array<{
      id: string;
      identifier: string;
      title: string;
      description?: string;
    }>;
  };
}

interface LinearResponse {
  data?: {
    issue?: LinearIssue;
  };
  errors?: Array<{ message: string }>;
}

export async function readLinearSpec(
  issueId: string,
): Promise<LinearSpecPayload> {
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    throw new SpecError(
      `LINEAR_API_KEY is not configured.\n\n` +
        `Add the following to your .env file:\n\n` +
        `  LINEAR_API_KEY=lin_api_xxxxxxxx\n\n` +
        `Get an API key at: https://linear.app/settings/api`,
    );
  }

  const query = `
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        children {
          nodes {
            id
            identifier
            title
            description
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { id: issueId },
      }),
    });

    if (!response.ok) {
      throw new SpecError(
        `Linear API error (${response.status}): ${response.statusText}`,
      );
    }

    const data = await response.json() as LinearResponse;

    if (data.errors && data.errors.length > 0) {
      const errorMsg = data.errors.map(e => e.message).join(", ");
      throw new SpecError(`Linear GraphQL error: ${errorMsg}`);
    }

    if (!data.data?.issue) {
      throw new SpecError(`Issue not found: ${issueId}`);
    }

    const issue = data.data.issue;
    const title = issue.title || issueId;
    const description = issue.description || "";

    const parts = [`# ${title}`, description];

    // Include sub-issues if present
    const children = issue.children?.nodes || [];
    if (children.length > 0) {
      const subSection = children
        .map((sub) => {
          const subTitle = sub.title || sub.identifier || "Untitled";
          const subDesc = sub.description ? `\n${sub.description}` : "";
          return `- **${subTitle}**${subDesc}`;
        })
        .join("\n");
      parts.push(`## Sub-issues\n\n${subSection}`);
    }

    const content = parts.filter(p => p.trim()).join("\n\n");

    return { source: "linear", issueId, title, content };
  } catch (err) {
    if (err instanceof SpecError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecError(`Failed to fetch Linear issue: ${message}`);
  }
}
