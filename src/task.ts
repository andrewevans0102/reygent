import type { SpecPayload } from "./spec.js";

export type AgentName =
  | "dev"
  | "qe"
  | "security-reviewer"
  | "planner"
  | "pr-reviewer"
  | "adhoc";

export type StageKind =
  | { kind: "agent"; agent: AgentName }
  | { kind: "parallel"; agents: AgentName[] }
  | { kind: "gate"; agent: AgentName; condition: string };

export interface TaskStage {
  name: string;
  description: string;
  execution: StageKind;
}

export interface StageResult {
  stage: string;
  success: boolean;
  output: string;
}

export interface PlannerOutput {
  goals: string[];
  tasks: string[];
  constraints: string[];
  dod: string[];
}

export interface PlannerClarification {
  needsClarification: true;
  questions: string[];
}

export type PlannerResult = PlannerOutput | PlannerClarification;

export interface DevOutput {
  files: string[];
}

export interface QEOutput {
  testFiles: string[];
}

export interface ImplementOutput {
  dev: DevOutput | null;
  qe: QEOutput | null;
}

export interface GateResult {
  passed: boolean;
  output: string;
}

export interface GateOutput {
  unitTests?: GateResult;
  functionalTests?: GateResult;
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SecurityFinding {
  severity: Severity;
  description: string;
  location?: { file: string; line?: number };
}

export interface SecurityReviewOutput {
  severity: Severity;
  findings: SecurityFinding[];
}

export interface PRCreateOutput {
  branch: string;
  commitMessage: string;
  prUrl: string;
  prNumber: number;
}

export interface PRReviewComment {
  file: string;
  line: number | null;
  comment: string;
}

export interface PRReviewOutput {
  summary: string;
  comments: PRReviewComment[];
  recommendedActions: string[];
}

export interface TaskContext {
  spec: SpecPayload;
  plan?: PlannerOutput;
  implement?: ImplementOutput;
  gates?: GateOutput;
  securityReview?: SecurityReviewOutput;
  prCreate?: PRCreateOutput;
  prReview?: PRReviewOutput;
  results: StageResult[];
}

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

export const PIPELINE: readonly TaskStage[] = [
  {
    name: "plan",
    description: "Generate structured plan from spec",
    execution: { kind: "agent", agent: "planner" },
  },
  {
    name: "implement",
    description: "Implement code and write functional tests in parallel",
    execution: { kind: "parallel", agents: ["dev", "qe"] },
  },
  {
    name: "gate-unit-tests",
    description: "Verify unit tests pass",
    execution: { kind: "gate", agent: "dev", condition: "unit-tests-pass" },
  },
  {
    name: "gate-functional-tests",
    description: "Verify functional tests pass",
    execution: {
      kind: "gate",
      agent: "qe",
      condition: "functional-tests-pass",
    },
  },
  {
    name: "security-review",
    description: "Security and vulnerability review",
    execution: { kind: "agent", agent: "security-reviewer" },
  },
  {
    name: "pr-create",
    description: "Create pull request",
    execution: { kind: "agent", agent: "pr-reviewer" },
  },
  {
    name: "pr-review",
    description: "Review pull request",
    execution: { kind: "agent", agent: "pr-reviewer" },
  },
] as const;
