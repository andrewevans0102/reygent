import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
import { getAgents } from "../config.js";
import { spawnAgent } from "../implement.js";
import { extractJSON } from "../planner.js";
import { createLiveStatus } from "../live-status.js";
import type { ActivityEvent } from "../live-status.js";
import { loadEnvFile } from "../env.js";
import { isDebug } from "../debug.js";
import { parseRemote, resolveToken } from "../pr-create.js";
import type { RemoteInfo } from "../pr-create.js";
import type { PlannerOutput } from "../task.js";
import { TaskError } from "../task.js";

interface ReviewCommentsOptions {
  insecure?: boolean;
  autoApprove?: boolean;
}

interface ReviewComment {
  author: string;
  body: string;
  path?: string;
  line?: number | null;
  createdAt: string;
  isSecurity?: boolean;
}

// ── Security comment classification ──

const SECURITY_KEYWORDS = [
  "xss", "cross-site scripting", "csrf", "cross-site request forgery",
  "sql injection", "sqli", "command injection", "code injection",
  "path traversal", "directory traversal",
  "ssrf", "server-side request forgery",
  "xxe", "rce", "remote code execution",
  "deserialization", "idor",
  "authentication", "authorization", "auth bypass",
  "privilege escalation", "broken access control",
  "session fixation", "session hijacking",
  "jwt", "token expir", "token leak",
  "hardcoded secret", "hardcoded password", "hardcoded key",
  "api key", "credential", "plaintext password",
  "weak hash", "md5", "sha1",
  "insecure random", "math.random",
  "sanitiz", "unsanitized", "unescaped",
  "untrusted input", "tainted",
  "innerhtml", "dangerouslysetinnerhtml", "eval(",
  "cors", "content-security-policy", "csp",
  "security header", "httponly", "secure flag",
  "vulnerability", "exploit", "attack vector",
  "owasp", "cve", "cwe",
  "security risk", "security issue", "security concern",
  "security review", "security finding",
  "denial of service", "dos",
  "race condition",
  "information disclosure", "data leak", "data exposure",
  "sensitive data",
];

function classifyComments(comments: ReviewComment[]): ReviewComment[] {
  return comments.map((c) => ({
    ...c,
    isSecurity: SECURITY_KEYWORDS.some((kw) => c.body.toLowerCase().includes(kw)),
  }));
}

// ── Private helpers (self-contained, matches review-work.ts convention) ──

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new TaskError(
              `review-comments: command failed: ${cmd} ${args.join(" ")}\n${stderr || stdout || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function getCurrentBranch(): Promise<string> {
  const branch = (await exec("git", ["branch", "--show-current"])).trim();
  if (!branch) {
    throw new TaskError("review-comments: not on a branch (detached HEAD?)");
  }
  return branch;
}

async function getDefaultBranch(): Promise<string> {
  try {
    const ref = (
      await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    try {
      const branches = (
        await exec("git", ["branch", "-r", "--list", "origin/main", "origin/master"])
      ).trim();
      const match = branches.match(/origin\/(main|master)/);
      if (match) return match[1];
    } catch {
      // ignore
    }
    return "main";
  }
}

async function detectGitHubPR(): Promise<number | null> {
  try {
    const json = await exec("gh", [
      "pr",
      "view",
      "--json",
      "number",
      "--jq",
      ".number",
    ]);
    const num = parseInt(json.trim(), 10);
    return isNaN(num) || num <= 0 ? null : num;
  } catch {
    return null;
  }
}

interface TlsOptions {
  rejectUnauthorized?: boolean;
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
  tlsOpts?: TlsOptions,
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
        ...tlsOpts,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function detectGitLabMR(
  remote: RemoteInfo,
  token: string,
  branch: string,
  insecure?: boolean,
): Promise<number | null> {
  const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
  const encodedBranch = encodeURIComponent(branch);
  const url = `https://${remote.host}/api/v4/projects/${projectPath}/merge_requests?source_branch=${encodedBranch}&state=opened`;
  const tlsOpts: TlsOptions = insecure ? { rejectUnauthorized: false } : {};

  try {
    const { status, text } = await httpsGet(
      url,
      { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      tlsOpts,
    );
    if (status < 200 || status >= 300) return null;
    const mrs = JSON.parse(text) as Array<{ iid: number }>;
    return mrs.length > 0 ? mrs[0].iid : null;
  } catch {
    return null;
  }
}

// ── Comment fetching ──

async function fetchGitHubComments(): Promise<ReviewComment[]> {
  const raw = await exec("gh", [
    "pr",
    "view",
    "--json",
    "comments,reviews",
  ]);
  const data = JSON.parse(raw) as {
    comments?: Array<{
      author?: { login?: string };
      body?: string;
      createdAt?: string;
    }>;
    reviews?: Array<{
      author?: { login?: string };
      body?: string;
      state?: string;
      createdAt?: string;
      comments?: Array<{
        author?: { login?: string };
        body?: string;
        path?: string;
        line?: number | null;
        createdAt?: string;
      }>;
    }>;
  };

  const comments: ReviewComment[] = [];

  // Issue-level comments
  if (data.comments) {
    for (const c of data.comments) {
      if (!c.body?.trim()) continue;
      comments.push({
        author: c.author?.login ?? "unknown",
        body: c.body,
        createdAt: c.createdAt ?? "",
      });
    }
  }

  // Review-level: top-level review body + inline comments
  if (data.reviews) {
    for (const r of data.reviews) {
      if (r.body?.trim()) {
        comments.push({
          author: r.author?.login ?? "unknown",
          body: r.body,
          createdAt: r.createdAt ?? "",
        });
      }
      if (r.comments) {
        for (const ic of r.comments) {
          if (!ic.body?.trim()) continue;
          comments.push({
            author: ic.author?.login ?? r.author?.login ?? "unknown",
            body: ic.body,
            path: ic.path,
            line: ic.line,
            createdAt: ic.createdAt ?? "",
          });
        }
      }
    }
  }

  return comments;
}

async function fetchGitLabComments(
  remote: RemoteInfo,
  token: string,
  mrIid: number,
  insecure?: boolean,
): Promise<ReviewComment[]> {
  const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
  const url = `https://${remote.host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes?per_page=100`;
  const tlsOpts: TlsOptions = insecure ? { rejectUnauthorized: false } : {};

  const { status, text } = await httpsGet(
    url,
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    tlsOpts,
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`review-comments: GitLab API error ${status}: ${text}`);
  }

  const notes = JSON.parse(text) as Array<{
    author?: { username?: string };
    body?: string;
    system?: boolean;
    created_at?: string;
    position?: {
      new_path?: string;
      new_line?: number | null;
    };
  }>;

  const comments: ReviewComment[] = [];
  for (const n of notes) {
    // Skip system-generated notes
    if (n.system) continue;
    if (!n.body?.trim()) continue;

    comments.push({
      author: n.author?.username ?? "unknown",
      body: n.body,
      path: n.position?.new_path,
      line: n.position?.new_line,
      createdAt: n.created_at ?? "",
    });
  }

  return comments;
}

// ── Display ──

function displayCommentSummary(comments: ReviewComment[]): void {
  const securityCount = comments.filter((c) => c.isSecurity).length;
  const generalCount = comments.length - securityCount;

  console.log(chalk.bold(`  ${comments.length} review comment(s) found`));
  if (securityCount > 0) {
    console.log(
      chalk.yellow(`  ⚠ ${securityCount} security-related`) +
        chalk.gray(` | ${generalCount} general`),
    );
  }
  console.log();

  for (const c of comments) {
    const location = c.path
      ? chalk.cyan(`  ${c.path}${c.line ? `:${c.line}` : ""}`)
      : chalk.gray("  (general)");
    const tag = c.isSecurity ? chalk.bgYellow.black(" SEC ") + " " : "";
    console.log(`  ${tag}${chalk.bold(c.author)} ${location}`);

    // Truncate long comments for summary display
    const preview = c.body.length > 200
      ? c.body.slice(0, 200) + "..."
      : c.body;
    for (const line of preview.split("\n")) {
      console.log(chalk.gray(`    ${line}`));
    }
    console.log();
  }
}

// ── Plan generation ──

function formatCommentBlock(comments: ReviewComment[]): string {
  const securityComments = comments.filter((c) => c.isSecurity);
  const generalComments = comments.filter((c) => !c.isSecurity);

  const formatOne = (c: ReviewComment) => {
    const loc = c.path ? `File: ${c.path}${c.line ? `:${c.line}` : ""}` : "General";
    return `- **${c.author}** (${loc}): ${c.body}`;
  };

  let block = "";
  if (securityComments.length > 0) {
    block += `### Security Comments (PRIORITY — must be addressed)\n\n`;
    block += securityComments.map(formatOne).join("\n");
    block += "\n\n";
  }
  if (generalComments.length > 0) {
    block += `### General Comments\n\n`;
    block += generalComments.map(formatOne).join("\n");
  }
  return block;
}

function buildPlanPrompt(
  systemPrompt: string,
  comments: ReviewComment[],
  diff: string,
): string {
  const hasSecurityComments = comments.some((c) => c.isSecurity);

  return `${systemPrompt}

---

## Review Comments to Address

${formatCommentBlock(comments)}

---

## Current Diff (branch vs base)

\`\`\`diff
${diff}
\`\`\`

---

## Instructions

Analyze the review comments above in the context of the current diff. Create a plan to address each comment.${hasSecurityComments ? " Security-related comments are marked as priority — ensure concrete fix tasks are generated for each one. Apply secure coding practices (input validation, output encoding, least privilege, etc.) when planning fixes." : ""} Return ONLY valid JSON:

\`\`\`json
{ "valid": true, "goals": ["..."], "tasks": ["..."], "constraints": ["..."], "dod": ["..."] }
\`\`\`

- **goals**: High-level objectives (e.g., "Address all review feedback")
- **tasks**: Specific actionable steps to fix/change code per reviewer comments
- **constraints**: Things to preserve or avoid breaking
- **dod**: How to verify each comment has been addressed

Each array must contain at least one non-empty string. Do not include any text outside the JSON object.`;
}

function buildPlanPromptWithFeedback(
  systemPrompt: string,
  comments: ReviewComment[],
  diff: string,
  feedback: string,
): string {
  const base = buildPlanPrompt(systemPrompt, comments, diff);
  return `${base}

---

## User Feedback on Previous Plan

The user reviewed the previous plan and provided this feedback. Incorporate it into your revised plan:

${feedback}`;
}

async function generatePlan(
  comments: ReviewComment[],
  diff: string,
  feedback?: string,
): Promise<PlannerOutput> {
  const agents = getAgents();
  const agent = agents.find((a) => a.role === "planner");
  if (!agent) {
    throw new TaskError("review-comments: no agent with role 'planner' found in config");
  }

  const prompt = feedback
    ? buildPlanPromptWithFeedback(agent.systemPrompt, comments, diff, feedback)
    : buildPlanPrompt(agent.systemPrompt, comments, diff);

  const result = await spawnAgent("planner", prompt, { quiet: true });

  if (result.exitCode !== 0) {
    throw new TaskError(`review-comments: planner agent exited with code ${result.exitCode}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(result.stdout));
  } catch {
    throw new TaskError("review-comments: failed to parse planner output as JSON");
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.valid !== true) {
    const errors = Array.isArray(obj.errors)
      ? (obj.errors as string[]).join("\n  - ")
      : "planner returned invalid plan";
    throw new TaskError(`review-comments: plan generation failed:\n  - ${errors}`);
  }

  const plan: PlannerOutput = {
    goals: Array.isArray(obj.goals) ? (obj.goals as string[]) : [],
    tasks: Array.isArray(obj.tasks) ? (obj.tasks as string[]) : [],
    constraints: Array.isArray(obj.constraints) ? (obj.constraints as string[]) : [],
    dod: Array.isArray(obj.dod) ? (obj.dod as string[]) : [],
  };

  if (plan.goals.length === 0 || plan.tasks.length === 0) {
    throw new TaskError("review-comments: planner returned empty goals or tasks");
  }

  return plan;
}

// ── Plan display and approval ──

function displayPlan(plan: PlannerOutput): void {
  console.log(chalk.bold("\n  Plan to Address Review Comments\n"));

  console.log(chalk.bold.blue("  Goals:"));
  for (const g of plan.goals) {
    console.log(`    - ${g}`);
  }
  console.log();

  console.log(chalk.bold.blue("  Tasks:"));
  for (const t of plan.tasks) {
    console.log(`    - ${t}`);
  }
  console.log();

  console.log(chalk.bold.blue("  Constraints:"));
  for (const c of plan.constraints) {
    console.log(`    - ${c}`);
  }
  console.log();

  console.log(chalk.bold.blue("  Definition of Done:"));
  for (const d of plan.dod) {
    console.log(`    - ${d}`);
  }
  console.log();
}

// ── Execution ──

function buildDevPrompt(
  systemPrompt: string,
  comments: ReviewComment[],
  plan: PlannerOutput,
  userInstructions?: string,
): string {
  const hasSecurityComments = comments.some((c) => c.isSecurity);

  let prompt = `${systemPrompt}

---

## Review Comments to Address

${formatCommentBlock(comments)}

---

## Plan

**Goals:**
${plan.goals.map((g) => `- ${g}`).join("\n")}

**Tasks:**
${plan.tasks.map((t) => `- ${t}`).join("\n")}

**Constraints:**
${plan.constraints.map((c) => `- ${c}`).join("\n")}

**Definition of Done:**
${plan.dod.map((d) => `- ${d}`).join("\n")}`;

  if (userInstructions) {
    prompt += `

---

## Additional Instructions from User

${userInstructions}`;
  }

  prompt += `

---

Implement the tasks above to address the review comments.${hasSecurityComments ? " Pay special attention to security-related comments — apply secure coding practices and ensure fixes do not introduce new vulnerabilities." : ""} When you are finished, output a JSON block with the list of files you created or modified:

\`\`\`json
{ "files": ["src/example.ts"] }
\`\`\``;

  return prompt;
}

async function executeWithDevAgent(
  comments: ReviewComment[],
  plan: PlannerOutput,
  autoApprove?: boolean,
  onActivity?: (event: ActivityEvent) => void,
  userInstructions?: string,
): Promise<void> {
  const agents = getAgents();
  const devAgent = agents.find((a) => a.name === "dev");
  if (!devAgent) {
    throw new TaskError("review-comments: no agent named 'dev' found in config");
  }

  const prompt = buildDevPrompt(devAgent.systemPrompt, comments, plan, userInstructions);

  const result = await spawnAgent("dev", prompt, { autoApprove, quiet: true, onActivity });

  if (result.exitCode !== 0) {
    throw new TaskError(`review-comments: dev agent exited with code ${result.exitCode}`);
  }

  // Extract files changed
  try {
    const parsed = JSON.parse(extractJSON(result.stdout)) as { files?: string[] };
    if (parsed.files && parsed.files.length > 0) {
      console.log();
      console.log(chalk.bold("  Files modified:"));
      for (const f of parsed.files) {
        console.log(`    - ${chalk.cyan(f)}`);
      }
    }
  } catch {
    // Non-critical — agent may not output structured JSON
  }
}

// ── Main command ──

export async function reviewCommentsCommand(
  options: ReviewCommentsOptions,
): Promise<void> {
  try {
    // 1. Verify git repo
    try {
      await exec("git", ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      console.log(chalk.red.bold("Error:"), "Not inside a git repository.");
      process.exit(1);
    }

    loadEnvFile();

    // 2. Detect platform
    const remoteUrl = (
      await exec("git", ["remote", "get-url", "origin"])
    ).trim();
    const remote = parseRemote(remoteUrl);
    const branch = await getCurrentBranch();
    const defaultBranch = await getDefaultBranch();

    console.log(
      chalk.gray(`  Platform: ${remote.platform}`) +
        chalk.gray(` | Branch: ${branch}`) +
        chalk.gray(` | Base: ${defaultBranch}`),
    );
    console.log();

    // 3. Check for PR/MR and fetch comments
    let comments: ReviewComment[] = [];

    if (remote.platform === "github") {
      const spinner = createLiveStatus("checking for open PR...");
      const prNumber = await detectGitHubPR();

      if (prNumber === null) {
        spinner.fail(chalk.red("No open PR found for this branch"));
        console.log();
        console.log(chalk.yellow("Cannot pull review comments without a PR or MR."));
        process.exit(1);
      }
      spinner.succeed(chalk.green(`Found PR #${prNumber}`));

      console.log();
      const commentSpinner = createLiveStatus("fetching review comments...");
      comments = await fetchGitHubComments();

      if (comments.length === 0) {
        commentSpinner.info(chalk.yellow("No review comments found on this PR"));
        return;
      }
      commentSpinner.succeed(chalk.green(`Fetched ${comments.length} comment(s)`));
    } else {
      // GitLab
      const spinner = createLiveStatus("checking for open MR...");
      let token: string;
      try {
        token = await resolveToken(remote.host);
      } catch (err) {
        if (isDebug()) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.gray(`[debug] Token resolution failed: ${msg}`));
        }
        spinner.fail(chalk.red("Could not resolve GitLab token"));
        console.log();
        console.log(chalk.yellow("Cannot pull review comments without a PR or MR."));
        process.exit(1);
      }

      const mrIid = await detectGitLabMR(remote, token, branch, options.insecure);
      if (mrIid === null) {
        spinner.fail(chalk.red("No open MR found for this branch"));
        console.log();
        console.log(chalk.yellow("Cannot pull review comments without a PR or MR."));
        process.exit(1);
      }
      spinner.succeed(chalk.green(`Found MR !${mrIid}`));

      console.log();
      const commentSpinner = createLiveStatus("fetching review comments...");
      comments = await fetchGitLabComments(remote, token, mrIid, options.insecure);

      if (comments.length === 0) {
        commentSpinner.info(chalk.yellow("No review comments found on this MR"));
        return;
      }
      commentSpinner.succeed(chalk.green(`Fetched ${comments.length} comment(s)`));
    }

    // 6. Classify and display comment summary
    comments = classifyComments(comments);
    console.log();
    displayCommentSummary(comments);

    // 7. Get git diff for context
    const diffSpinner = createLiveStatus("generating diff...");
    const diff = await exec("git", ["diff", `${defaultBranch}...HEAD`]);
    if (!diff.trim()) {
      diffSpinner.warn(chalk.yellow("No diff found against base branch"));
    } else {
      diffSpinner.succeed(chalk.green("Diff loaded"));
    }

    // 8. Generate plan
    let plan: PlannerOutput;
    {
      const planSpinner = createLiveStatus("generating plan...");
      plan = await generatePlan(comments, diff);
      planSpinner.succeed(chalk.green("Plan generated"));
    }

    displayPlan(plan);

    // 9. Approval loop with additional instructions support
    let userInstructions: string | undefined;

    if (!options.autoApprove) {
      let approved = false;
      while (!approved) {
        const action = await select({
          message: "How would you like to proceed?",
          choices: [
            { name: "Approve — execute plan", value: "approve" },
            { name: "Provide feedback — regenerate plan", value: "feedback" },
            { name: "Add instructions — pass extra guidance to dev agent", value: "instructions" },
            { name: "Reject — exit without changes", value: "reject" },
          ],
        });

        if (action === "approve") {
          approved = true;
        } else if (action === "feedback") {
          const feedback = await input({
            message: "Enter your feedback:",
          });
          if (feedback.trim()) {
            const planSpinner = createLiveStatus("regenerating plan...");
            plan = await generatePlan(comments, diff, feedback);
            planSpinner.succeed(chalk.green("Plan regenerated"));
            displayPlan(plan);
          }
        } else if (action === "instructions") {
          const extra = await input({
            message: "Enter additional instructions for the dev agent:",
          });
          if (extra.trim()) {
            userInstructions = userInstructions
              ? `${userInstructions}\n\n${extra.trim()}`
              : extra.trim();
            console.log(chalk.green("  Instructions saved. They will be included when executing."));
            console.log(chalk.gray(`  Current instructions:\n    ${userInstructions.split("\n").join("\n    ")}`));
            console.log();
          }
        } else {
          console.log(chalk.yellow("\n  Rejected. No changes made.\n"));
          return;
        }
      }
    }

    // 10. Execute
    console.log();
    const execStatus = createLiveStatus("addressing review comments...");

    // User approved the plan (or --auto-approve was set), so dev agent can write freely
    await executeWithDevAgent(comments, plan, true, execStatus.onActivity, userInstructions);
    execStatus.succeed(chalk.green("Dev agent finished"));

    // 11. Commit and push changes
    console.log();
    const pushSpinner = createLiveStatus("committing and pushing...");
    try {
      await exec("git", ["add", "-A"]);
      await exec("git", ["commit", "-m", "fix: address PR review comments"]);
      await exec("git", ["push", "origin", branch]);
      pushSpinner.succeed(chalk.green("Changes committed and pushed."));
    } catch (pushErr) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      if (msg.includes("nothing to commit")) {
        // Agent may have committed already — check if we have unpushed commits
        try {
          const ahead = await exec("git", [
            "rev-list", "--count", `origin/${branch}..HEAD`,
          ]);
          if (parseInt(ahead.trim(), 10) > 0) {
            await exec("git", ["push", "origin", branch]);
            pushSpinner.succeed(chalk.green("Changes pushed."));
          } else {
            pushSpinner.warn(chalk.yellow("No changes were made by the dev agent."));
          }
        } catch {
          pushSpinner.warn(chalk.yellow("Nothing to commit or push."));
        }
      } else {
        pushSpinner.fail(chalk.red(`Push failed: ${msg}`));
      }
    }

    console.log();
    console.log(chalk.green.bold("  Done!"), chalk.gray("Review comments addressed."));
    console.log();
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") {
      process.exit(0);
    }
    if (err instanceof TaskError) {
      console.log(chalk.red.bold("Error:"), err.message);
      if (isDebug()) console.error(err.stack);
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red.bold("Internal error:"), message);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}
