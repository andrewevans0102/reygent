import { builtinAgents } from "./agents.js";
import { spawnAgent, type AgentSpawnOptions } from "./implement.js";
import { extractJSON } from "./planner.js";
import type {
  Severity,
  SecurityFinding,
  SecurityReviewOutput,
  TaskContext,
} from "./task.js";
import { TaskError } from "./task.js";

const SEVERITY_ORDER: Record<Severity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function severityAtOrAbove(
  severity: Severity,
  threshold: Severity,
): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

function buildSecurityReviewPrompt(
  systemPrompt: string,
  context: TaskContext,
): string {
  const devFiles = context.implement?.dev?.files ?? [];
  const qeFiles = context.implement?.qe?.testFiles ?? [];

  return `${systemPrompt}

---

## Spec

**Title:** ${context.spec.title}

${context.spec.content}

---

## Files to review

**Implementation files (dev):**
${devFiles.length > 0 ? devFiles.map((f) => `- ${f}`).join("\n") : "- (none)"}

**Test files (qe):**
${qeFiles.length > 0 ? qeFiles.map((f) => `- ${f}`).join("\n") : "- (none)"}

---

## Instructions

1. Read each file listed above.
2. Analyse the code for security vulnerabilities, including but not limited to the OWASP Top 10: injection, broken authentication, sensitive data exposure, XXE, broken access control, security misconfiguration, XSS, insecure deserialization, using components with known vulnerabilities, and insufficient logging.
3. For each finding, assign a severity: CRITICAL, HIGH, MEDIUM, or LOW.
4. When you are finished, output a single JSON block with your findings:

\`\`\`json
{
  "severity": "HIGH",
  "findings": [
    {
      "severity": "HIGH",
      "description": "SQL injection in user input handler",
      "location": { "file": "src/db.ts", "line": 42 }
    }
  ]
}
\`\`\`

- The top-level \`severity\` is the highest severity among all findings, or "LOW" if there are no findings.
- If no issues are found, return \`{ "severity": "LOW", "findings": [] }\`.
- Do NOT output any text after the JSON block.`;
}

export function extractSecurityReviewOutput(
  stdout: string,
): SecurityReviewOutput {
  const cleaned = extractJSON(stdout);
  const match = cleaned.match(
    /\{\s*"severity"\s*:\s*"[^"]+"\s*,\s*"findings"\s*:\s*\[[\s\S]*?\]\s*\}/,
  );
  if (!match) {
    throw new TaskError(
      "security-review: failed to extract JSON output from agent response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new TaskError(
      "security-review: extracted block is not valid JSON",
    );
  }

  const obj = parsed as Record<string, unknown>;

  const validSeverities = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

  if (typeof obj.severity !== "string" || !validSeverities.has(obj.severity)) {
    throw new TaskError(
      "security-review: invalid top-level severity in output",
    );
  }

  if (!Array.isArray(obj.findings)) {
    throw new TaskError("security-review: 'findings' must be an array");
  }

  const findings: SecurityFinding[] = (obj.findings as unknown[]).map(
    (f, i) => {
      const finding = f as Record<string, unknown>;
      if (
        typeof finding.severity !== "string" ||
        !validSeverities.has(finding.severity)
      ) {
        throw new TaskError(
          `security-review: finding[${i}] has invalid severity`,
        );
      }
      if (typeof finding.description !== "string") {
        throw new TaskError(
          `security-review: finding[${i}] missing description`,
        );
      }

      const result: SecurityFinding = {
        severity: finding.severity as Severity,
        description: finding.description,
      };

      if (finding.location && typeof finding.location === "object") {
        const loc = finding.location as Record<string, unknown>;
        if (typeof loc.file === "string") {
          result.location = {
            file: loc.file,
            ...(typeof loc.line === "number" ? { line: loc.line } : {}),
          };
        }
      }

      return result;
    },
  );

  return { severity: obj.severity as Severity, findings };
}

export function formatFindings(
  findings: SecurityFinding[],
  threshold: Severity,
): string {
  if (findings.length === 0) return "  No findings.";

  return findings
    .map((f) => {
      const marker = severityAtOrAbove(f.severity, threshold) ? "!! " : "   ";
      const loc = f.location
        ? ` (${f.location.file}${f.location.line ? `:${f.location.line}` : ""})`
        : "";
      return `${marker}[${f.severity}] ${f.description}${loc}`;
    })
    .join("\n");
}

export async function runSecurityReview(
  context: TaskContext,
  threshold: Severity,
  options?: AgentSpawnOptions,
): Promise<{ output: SecurityReviewOutput; passed: boolean }> {
  const agent = builtinAgents.find((a) => a.name === "security-reviewer");
  if (!agent) {
    throw new TaskError("security-review: missing security-reviewer agent config");
  }

  const prompt = buildSecurityReviewPrompt(agent.systemPrompt, context);
  const result = await spawnAgent("security-review", prompt, options);

  if (result.exitCode !== 0) {
    throw new TaskError(
      `security-review: agent exited with code ${result.exitCode}`,
    );
  }

  const output = extractSecurityReviewOutput(result.stdout);

  const hasBlockingFinding = output.findings.some((f) =>
    severityAtOrAbove(f.severity, threshold),
  );

  return { output, passed: !hasBlockingFinding };
}
