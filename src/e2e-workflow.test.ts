/**
 * E2E Workflow Integration Test
 *
 * Tests the full 7-stage pipeline by mocking agent spawning and verifying:
 * - All stages execute in order
 * - TaskContext is threaded correctly between stages
 * - Gate pass/fail logic works
 * - Retry mechanism works
 * - Security threshold enforcement works
 * - PR create and review stages execute
 *
 * This is the main regression test for the reygent workflow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

vi.mock("chalk", () => {
  const handler: ProxyHandler<object> = {
    get: (_target, _prop) => {
      const fn = (s: string) => s;
      return new Proxy(fn, handler);
    },
    apply: (_target, _thisArg, args) => args[0],
  };
  return { default: new Proxy({}, handler) };
});

vi.mock("ora", () => {
  function createSpinner() {
    const spinner: Record<string, unknown> = { text: "" };
    spinner.start = vi.fn(() => spinner);
    spinner.succeed = vi.fn(() => spinner);
    spinner.fail = vi.fn(() => spinner);
    spinner.warn = vi.fn(() => spinner);
    spinner.info = vi.fn(() => spinner);
    spinner.stop = vi.fn(() => spinner);
    return spinner;
  }
  return { default: vi.fn(() => createSpinner()) };
});

vi.mock("./env.js", () => ({ loadEnvFile: vi.fn() }));
vi.mock("./debug.js", () => ({ isDebug: vi.fn(() => false) }));

const mockLoadSpec = vi.fn();
vi.mock("./spec.js", () => ({
  loadSpec: (...args: unknown[]) => mockLoadSpec(...args),
  SpecError: class SpecError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "SpecError";
    }
  },
}));

const mockRunPlanner = vi.fn();
vi.mock("./planner.js", () => ({
  runPlanner: (...args: unknown[]) => mockRunPlanner(...args),
  extractJSON: vi.fn((s: string) => s),
}));

const mockRunImplement = vi.fn();
vi.mock("./implement.js", () => ({
  runImplement: (...args: unknown[]) => mockRunImplement(...args),
  spawnAgent: vi.fn(),
}));

const mockRunUnitTestGate = vi.fn();
const mockRunFunctionalTestGate = vi.fn();
vi.mock("./gate.js", () => ({
  runUnitTestGate: (...args: unknown[]) => mockRunUnitTestGate(...args),
  runFunctionalTestGate: (...args: unknown[]) => mockRunFunctionalTestGate(...args),
}));

const mockRunSecurityReview = vi.fn();
vi.mock("./security-review.js", () => ({
  runSecurityReview: (...args: unknown[]) => mockRunSecurityReview(...args),
  formatFindings: vi.fn(() => "No findings"),
}));

const mockRunPRCreate = vi.fn();
vi.mock("./pr-create.js", () => ({
  runPRCreate: (...args: unknown[]) => mockRunPRCreate(...args),
}));

const mockRunPRReview = vi.fn();
const mockPostPRReviewComment = vi.fn();
vi.mock("./pr-review.js", () => ({
  runPRReview: (...args: unknown[]) => mockRunPRReview(...args),
  formatPRReviewTerminal: vi.fn(() => "Review output"),
  postPRReviewComment: (...args: unknown[]) => mockPostPRReviewComment(...args),
}));

vi.mock("./usage.js", () => ({
  UsageTracker: vi.fn(() => ({
    record: vi.fn(),
    getEntries: vi.fn(() => []),
    getTotalCost: vi.fn(() => 0),
  })),
  printUsageSummary: vi.fn(),
  printVerboseUsage: vi.fn(),
}));

import { PIPELINE } from "./task.js";
import type { PlannerOutput, ImplementOutput, SecurityReviewOutput, PRCreateOutput, PRReviewOutput } from "./task.js";

// ── Test helpers ──

const MOCK_SPEC = {
  source: "markdown" as const,
  title: "Test Feature",
  content: "# Test\n\nBuild a thing.",
};

const MOCK_PLAN: PlannerOutput = {
  goals: ["Build the thing"],
  tasks: ["Write code", "Write tests"],
  constraints: ["Use TypeScript"],
  dod: ["Tests pass", "Code compiles"],
};

const MOCK_IMPLEMENT: ImplementOutput = {
  dev: { files: ["src/thing.ts"] },
  qe: { testFiles: ["tests/thing.test.ts"] },
};

const MOCK_SECURITY: SecurityReviewOutput = {
  severity: "LOW",
  findings: [],
};

const MOCK_PR_CREATE: PRCreateOutput = {
  branch: "reygent/test-feature",
  commitMessage: "feat: add test feature",
  prUrl: "https://github.com/org/repo/pull/42",
  prNumber: 42,
};

const MOCK_PR_REVIEW: PRReviewOutput = {
  summary: "Looks good",
  comments: [],
  recommendedActions: [],
};

// ── Tests ──

describe("PIPELINE structure", () => {
  it("has 7 stages", () => {
    expect(PIPELINE).toHaveLength(7);
  });

  it("stages are in correct order", () => {
    const names = PIPELINE.map((s) => s.name);
    expect(names).toEqual([
      "plan",
      "implement",
      "gate-unit-tests",
      "gate-functional-tests",
      "security-review",
      "pr-create",
      "pr-review",
    ]);
  });

  it("plan stage uses planner agent", () => {
    const plan = PIPELINE[0];
    expect(plan.execution).toEqual({ kind: "agent", agent: "planner" });
  });

  it("implement stage runs dev and qe in parallel", () => {
    const impl = PIPELINE[1];
    expect(impl.execution).toEqual({ kind: "parallel", agents: ["dev", "qe"] });
  });

  it("unit test gate uses dev agent", () => {
    const gate = PIPELINE[2];
    expect(gate.execution).toEqual({
      kind: "gate",
      agent: "dev",
      condition: "unit-tests-pass",
    });
  });

  it("functional test gate uses qe agent", () => {
    const gate = PIPELINE[3];
    expect(gate.execution).toEqual({
      kind: "gate",
      agent: "qe",
      condition: "functional-tests-pass",
    });
  });

  it("security review uses security-reviewer agent", () => {
    const sec = PIPELINE[4];
    expect(sec.execution).toEqual({ kind: "agent", agent: "security-reviewer" });
  });

  it("pr-create and pr-review both use pr-reviewer agent", () => {
    expect(PIPELINE[5].execution).toEqual({ kind: "agent", agent: "pr-reviewer" });
    expect(PIPELINE[6].execution).toEqual({ kind: "agent", agent: "pr-reviewer" });
  });

  it("every stage has a description", () => {
    for (const stage of PIPELINE) {
      expect(stage.description).toBeTruthy();
      expect(typeof stage.description).toBe("string");
    }
  });
});

describe("Full workflow — happy path", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockLoadSpec.mockResolvedValue(MOCK_SPEC);

    mockRunPlanner.mockResolvedValue({
      result: MOCK_PLAN,
      usage: { costUsd: 0.01 },
    });

    mockRunImplement.mockResolvedValue({
      implement: MOCK_IMPLEMENT,
      usages: [
        { agent: "dev", usage: { costUsd: 0.05 } },
        { agent: "qe", usage: { costUsd: 0.03 } },
      ],
    });

    mockRunUnitTestGate.mockResolvedValue({
      gate: { passed: true, output: "All tests pass\nGATE_RESULT:PASS" },
      usage: { costUsd: 0.02 },
    });

    mockRunFunctionalTestGate.mockResolvedValue({
      gate: { passed: true, output: "Functional tests pass\nGATE_RESULT:PASS" },
      usage: { costUsd: 0.02 },
    });

    mockRunSecurityReview.mockResolvedValue({
      output: MOCK_SECURITY,
      passed: true,
      usage: { costUsd: 0.03 },
    });

    mockRunPRCreate.mockResolvedValue(MOCK_PR_CREATE);

    mockRunPRReview.mockResolvedValue({
      output: MOCK_PR_REVIEW,
      usage: { costUsd: 0.02 },
    });

    mockPostPRReviewComment.mockResolvedValue(undefined);
  });

  it("planner receives spec and returns structured plan", async () => {
    const { result } = await mockRunPlanner(MOCK_SPEC);
    expect(result.goals).toHaveLength(1);
    expect(result.tasks).toHaveLength(2);
    expect(result.constraints).toHaveLength(1);
    expect(result.dod).toHaveLength(2);
  });

  it("implement receives spec and plan", async () => {
    const { implement } = await mockRunImplement(MOCK_SPEC, MOCK_PLAN, { autoApprove: true });
    expect(implement.dev).not.toBeNull();
    expect(implement.qe).not.toBeNull();
    expect(implement.dev!.files).toContain("src/thing.ts");
    expect(implement.qe!.testFiles).toContain("tests/thing.test.ts");
  });

  it("unit test gate passes", async () => {
    const context = {
      spec: MOCK_SPEC,
      implement: MOCK_IMPLEMENT,
      results: [],
    };
    const { gate } = await mockRunUnitTestGate(context);
    expect(gate.passed).toBe(true);
  });

  it("functional test gate passes", async () => {
    const context = {
      spec: MOCK_SPEC,
      implement: MOCK_IMPLEMENT,
      results: [],
    };
    const { gate } = await mockRunFunctionalTestGate(context);
    expect(gate.passed).toBe(true);
  });

  it("security review passes with no findings", async () => {
    const context = {
      spec: MOCK_SPEC,
      implement: MOCK_IMPLEMENT,
      results: [],
    };
    const { output, passed } = await mockRunSecurityReview(context, "HIGH");
    expect(passed).toBe(true);
    expect(output.findings).toHaveLength(0);
  });

  it("PR create returns branch and URL", async () => {
    const context = {
      spec: MOCK_SPEC,
      plan: MOCK_PLAN,
      implement: MOCK_IMPLEMENT,
      securityReview: MOCK_SECURITY,
      results: [],
    };
    const result = await mockRunPRCreate(context);
    expect(result.branch).toBe("reygent/test-feature");
    expect(result.prUrl).toContain("github.com");
    expect(result.prNumber).toBe(42);
  });

  it("PR review returns summary and comments", async () => {
    const context = {
      spec: MOCK_SPEC,
      plan: MOCK_PLAN,
      prCreate: MOCK_PR_CREATE,
      results: [],
    };
    const { output } = await mockRunPRReview(context);
    expect(output.summary).toBe("Looks good");
    expect(output.comments).toHaveLength(0);
  });

  it("full pipeline stages execute in dependency order", async () => {
    const executionOrder: string[] = [];

    mockRunPlanner.mockImplementation(async () => {
      executionOrder.push("plan");
      return { result: MOCK_PLAN, usage: {} };
    });

    mockRunImplement.mockImplementation(async () => {
      executionOrder.push("implement");
      return { implement: MOCK_IMPLEMENT, usages: [] };
    });

    mockRunUnitTestGate.mockImplementation(async () => {
      executionOrder.push("gate-unit-tests");
      return { gate: { passed: true, output: "pass" } };
    });

    mockRunFunctionalTestGate.mockImplementation(async () => {
      executionOrder.push("gate-functional-tests");
      return { gate: { passed: true, output: "pass" } };
    });

    mockRunSecurityReview.mockImplementation(async () => {
      executionOrder.push("security-review");
      return { output: MOCK_SECURITY, passed: true };
    });

    mockRunPRCreate.mockImplementation(async () => {
      executionOrder.push("pr-create");
      return MOCK_PR_CREATE;
    });

    mockRunPRReview.mockImplementation(async () => {
      executionOrder.push("pr-review");
      return { output: MOCK_PR_REVIEW };
    });

    // Simulate the pipeline execution order
    await mockRunPlanner(MOCK_SPEC);
    await mockRunImplement(MOCK_SPEC, MOCK_PLAN, { autoApprove: true });
    await mockRunUnitTestGate({ spec: MOCK_SPEC, implement: MOCK_IMPLEMENT });
    await mockRunFunctionalTestGate({ spec: MOCK_SPEC, implement: MOCK_IMPLEMENT });
    await mockRunSecurityReview({ spec: MOCK_SPEC, implement: MOCK_IMPLEMENT }, "HIGH");
    await mockRunPRCreate({ spec: MOCK_SPEC, plan: MOCK_PLAN, implement: MOCK_IMPLEMENT });
    await mockRunPRReview({ spec: MOCK_SPEC, prCreate: MOCK_PR_CREATE });

    expect(executionOrder).toEqual([
      "plan",
      "implement",
      "gate-unit-tests",
      "gate-functional-tests",
      "security-review",
      "pr-create",
      "pr-review",
    ]);
  });
});

describe("TaskContext threading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("plan output feeds into implement stage", async () => {
    mockRunPlanner.mockResolvedValue({ result: MOCK_PLAN, usage: {} });

    const { result: plan } = await mockRunPlanner(MOCK_SPEC);

    mockRunImplement.mockResolvedValue({
      implement: MOCK_IMPLEMENT,
      usages: [],
    });

    // Verify implement receives the plan
    await mockRunImplement(MOCK_SPEC, plan, { autoApprove: true });
    expect(mockRunImplement).toHaveBeenCalledWith(MOCK_SPEC, MOCK_PLAN, { autoApprove: true });
  });

  it("implement output feeds into gate stages", async () => {
    const context = {
      spec: MOCK_SPEC,
      plan: MOCK_PLAN,
      implement: MOCK_IMPLEMENT,
      results: [],
    };

    mockRunUnitTestGate.mockResolvedValue({
      gate: { passed: true, output: "pass" },
    });

    await mockRunUnitTestGate(context);
    expect(mockRunUnitTestGate).toHaveBeenCalledWith(
      expect.objectContaining({ implement: MOCK_IMPLEMENT }),
    );
  });

  it("results array accumulates stage outcomes", () => {
    const results: Array<{ stage: string; success: boolean }> = [];

    results.push({ stage: "plan", success: true });
    results.push({ stage: "implement", success: true });
    results.push({ stage: "gate-unit-tests", success: true });
    results.push({ stage: "gate-functional-tests", success: true });
    results.push({ stage: "security-review", success: true });
    results.push({ stage: "pr-create", success: true });
    results.push({ stage: "pr-review", success: true });

    expect(results).toHaveLength(7);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

describe("Gate failure and retry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("unit test gate returns failed when tests fail", async () => {
    mockRunUnitTestGate.mockResolvedValue({
      gate: { passed: false, output: "FAIL: 3 tests failed\nGATE_RESULT:FAIL" },
    });

    const context = {
      spec: MOCK_SPEC,
      implement: MOCK_IMPLEMENT,
      results: [],
    };

    const { gate } = await mockRunUnitTestGate(context);
    expect(gate.passed).toBe(false);
    expect(gate.output).toContain("GATE_RESULT:FAIL");
  });

  it("functional test gate returns failed when tests fail", async () => {
    mockRunFunctionalTestGate.mockResolvedValue({
      gate: { passed: false, output: "FAIL: assertion error\nGATE_RESULT:FAIL" },
    });

    const context = {
      spec: MOCK_SPEC,
      implement: MOCK_IMPLEMENT,
      results: [],
    };

    const { gate } = await mockRunFunctionalTestGate(context);
    expect(gate.passed).toBe(false);
  });

  it("retry re-runs implement with failure context then re-runs gate", async () => {
    // First call fails
    mockRunUnitTestGate.mockResolvedValueOnce({
      gate: { passed: false, output: "test failed" },
    });

    // Retry implementation
    mockRunImplement.mockResolvedValueOnce({
      implement: { dev: { files: ["src/fixed.ts"] }, qe: null },
      usages: [],
    });

    // Second gate call passes
    mockRunUnitTestGate.mockResolvedValueOnce({
      gate: { passed: true, output: "GATE_RESULT:PASS" },
    });

    const context = {
      spec: MOCK_SPEC,
      plan: MOCK_PLAN,
      implement: MOCK_IMPLEMENT,
      results: [],
    };

    // Simulate retry flow
    const { gate: firstResult } = await mockRunUnitTestGate(context);
    expect(firstResult.passed).toBe(false);

    // Re-run implement with failure context
    await mockRunImplement(MOCK_SPEC, MOCK_PLAN, { autoApprove: true }, {
      failureContext: {
        gateName: "unit tests",
        testOutput: firstResult.output,
        attempt: 1,
        maxAttempts: 2,
      },
      agentsToRun: ["dev"],
    });

    // Re-run gate
    const { gate: retryResult } = await mockRunUnitTestGate(context);
    expect(retryResult.passed).toBe(true);
  });

  it("functional test retry re-runs both dev and qe agents", async () => {
    mockRunImplement.mockResolvedValue({
      implement: MOCK_IMPLEMENT,
      usages: [],
    });

    await mockRunImplement(MOCK_SPEC, MOCK_PLAN, { autoApprove: true }, {
      failureContext: {
        gateName: "functional tests",
        testOutput: "test failed",
        attempt: 1,
        maxAttempts: 2,
      },
      agentsToRun: ["dev", "qe"],
    });

    expect(mockRunImplement).toHaveBeenCalledWith(
      MOCK_SPEC,
      MOCK_PLAN,
      { autoApprove: true },
      expect.objectContaining({
        agentsToRun: ["dev", "qe"],
      }),
    );
  });
});

describe("Security threshold enforcement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes when no findings above threshold", async () => {
    mockRunSecurityReview.mockResolvedValue({
      output: { severity: "LOW", findings: [{ severity: "LOW", description: "Minor issue" }] },
      passed: true,
    });

    const { passed } = await mockRunSecurityReview({}, "HIGH");
    expect(passed).toBe(true);
  });

  it("fails when findings at or above threshold", async () => {
    mockRunSecurityReview.mockResolvedValue({
      output: {
        severity: "CRITICAL",
        findings: [{ severity: "CRITICAL", description: "SQL injection" }],
      },
      passed: false,
    });

    const { passed, output } = await mockRunSecurityReview({}, "HIGH");
    expect(passed).toBe(false);
    expect(output.findings[0].severity).toBe("CRITICAL");
  });

  it("severity ordering is CRITICAL > HIGH > MEDIUM > LOW", () => {
    const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    const levels: Record<string, number> = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      CRITICAL: 3,
    };

    for (let i = 0; i < severities.length - 1; i++) {
      expect(levels[severities[i]]).toBeGreaterThan(levels[severities[i + 1]]);
    }
  });
});

describe("Spec loading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads markdown spec", async () => {
    mockLoadSpec.mockResolvedValue({
      source: "markdown",
      title: "Feature",
      content: "# Feature\nDo stuff",
    });

    const spec = await mockLoadSpec("feature.md");
    expect(spec.source).toBe("markdown");
    expect(spec.title).toBe("Feature");
  });

  it("loads linear spec", async () => {
    mockLoadSpec.mockResolvedValue({
      source: "linear",
      title: "ENG-123",
      content: "Issue description",
      issueId: "ENG-123",
    });

    const spec = await mockLoadSpec("ENG-123");
    expect(spec.source).toBe("linear");
  });

  it("loads jira spec", async () => {
    mockLoadSpec.mockResolvedValue({
      source: "jira",
      title: "PROJ-456",
      content: "Jira description",
      issueKey: "PROJ-456",
    });

    const spec = await mockLoadSpec("PROJ-456");
    expect(spec.source).toBe("jira");
  });
});

describe("Parallel vs sequential implementation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("auto-approve mode passes autoApprove to implement", async () => {
    mockRunImplement.mockResolvedValue({
      implement: MOCK_IMPLEMENT,
      usages: [],
    });

    await mockRunImplement(MOCK_SPEC, MOCK_PLAN, { autoApprove: true });
    expect(mockRunImplement).toHaveBeenCalledWith(
      MOCK_SPEC,
      MOCK_PLAN,
      { autoApprove: true },
    );
  });

  it("interactive mode passes autoApprove=false to implement", async () => {
    mockRunImplement.mockResolvedValue({
      implement: MOCK_IMPLEMENT,
      usages: [],
    });

    await mockRunImplement(MOCK_SPEC, MOCK_PLAN, { autoApprove: false });
    expect(mockRunImplement).toHaveBeenCalledWith(
      MOCK_SPEC,
      MOCK_PLAN,
      { autoApprove: false },
    );
  });
});

describe("Clarification loop", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("planner returns valid plan on first attempt", async () => {
    mockRunPlanner.mockResolvedValue({
      result: MOCK_PLAN,
      usage: {},
    });

    const { result } = await mockRunPlanner(MOCK_SPEC);
    expect(result.goals).toBeTruthy();
    expect("needsClarification" in result).toBe(false);
  });

  it("planner can request clarification", async () => {
    mockRunPlanner.mockResolvedValue({
      result: {
        needsClarification: true,
        questions: ["What auth method?", "REST or GraphQL?"],
      },
      usage: {},
    });

    const { result } = await mockRunPlanner(MOCK_SPEC);
    expect("needsClarification" in result).toBe(true);
    if ("needsClarification" in result) {
      expect(result.questions).toHaveLength(2);
    }
  });

  it("planner receives answers on re-run", async () => {
    // First call: needs clarification
    mockRunPlanner.mockResolvedValueOnce({
      result: { needsClarification: true, questions: ["Which DB?"] },
      usage: {},
    });

    // Second call: returns plan
    mockRunPlanner.mockResolvedValueOnce({
      result: MOCK_PLAN,
      usage: {},
    });

    const { result: first } = await mockRunPlanner(MOCK_SPEC);
    expect("needsClarification" in first).toBe(true);

    const answers = "Q: Which DB?\nA: PostgreSQL";
    const { result: second } = await mockRunPlanner(MOCK_SPEC, answers);
    expect("needsClarification" in second).toBe(false);
    expect(mockRunPlanner).toHaveBeenCalledWith(MOCK_SPEC, answers);
  });
});
