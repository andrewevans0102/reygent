import type { SpecPayload, PlannerOutput, ImplementOutput, GateResult, SecurityReviewOutput } from "../../src/task.js";
import { markdownSpec, linearSpec, minimalSpec } from "./specs.js";
import { authPlan, cachingPlan, minimalPlan } from "./plans.js";
import { authImplementation, cachingImplementation, minimalImplementation } from "./implementations.js";

/** Scenario: Full happy path — all stages pass */
export interface HappyPathScenario {
  spec: SpecPayload;
  plan: PlannerOutput;
  implement: ImplementOutput;
  unitTestGate: GateResult;
  functionalTestGate: GateResult;
  securityReview: SecurityReviewOutput;
}

export const happyPathScenario: HappyPathScenario = {
  spec: markdownSpec,
  plan: authPlan,
  implement: authImplementation,
  unitTestGate: {
    passed: true,
    output: "All unit tests passed\nGATE_RESULT:PASS",
  },
  functionalTestGate: {
    passed: true,
    output: "All functional tests passed\nGATE_RESULT:PASS",
  },
  securityReview: {
    severity: "LOW",
    findings: [],
  },
};

/** Scenario: Unit test gate failure on first attempt */
export interface GateFailureScenario {
  spec: SpecPayload;
  plan: PlannerOutput;
  implement: ImplementOutput;
  firstUnitTestGate: GateResult;
  fixedImplementation: ImplementOutput;
  retryUnitTestGate: GateResult;
  functionalTestGate: GateResult;
  securityReview: SecurityReviewOutput;
}

export const gateFailureScenario: GateFailureScenario = {
  spec: linearSpec,
  plan: cachingPlan,
  implement: cachingImplementation,
  firstUnitTestGate: {
    passed: false,
    output: "FAIL: src/cache/redis.test.ts\n  Expected cache hit but got miss\nGATE_RESULT:FAIL",
  },
  fixedImplementation: {
    dev: {
      files: ["src/cache/redis.ts"],
    },
    qe: null,
  },
  retryUnitTestGate: {
    passed: true,
    output: "All unit tests passed\nGATE_RESULT:PASS",
  },
  functionalTestGate: {
    passed: true,
    output: "All functional tests passed\nGATE_RESULT:PASS",
  },
  securityReview: {
    severity: "LOW",
    findings: [],
  },
};

/** Scenario: Security gate failure with CRITICAL finding */
export interface SecurityFailureScenario {
  spec: SpecPayload;
  plan: PlannerOutput;
  implement: ImplementOutput;
  unitTestGate: GateResult;
  functionalTestGate: GateResult;
  securityReview: SecurityReviewOutput;
}

export const securityFailureScenario: SecurityFailureScenario = {
  spec: markdownSpec,
  plan: authPlan,
  implement: authImplementation,
  unitTestGate: {
    passed: true,
    output: "All unit tests passed\nGATE_RESULT:PASS",
  },
  functionalTestGate: {
    passed: true,
    output: "All functional tests passed\nGATE_RESULT:PASS",
  },
  securityReview: {
    severity: "CRITICAL",
    findings: [
      {
        severity: "CRITICAL",
        description: "SQL injection vulnerability in login query",
        location: { file: "src/auth/login.ts", line: 42 },
      },
      {
        severity: "HIGH",
        description: "JWT secret hardcoded in source code",
        location: { file: "src/auth/jwt.ts", line: 12 },
      },
    ],
  },
};

/** Scenario: Minimal implementation (smoke test) */
export const minimalScenario: HappyPathScenario = {
  spec: minimalSpec,
  plan: minimalPlan,
  implement: minimalImplementation,
  unitTestGate: {
    passed: true,
    output: "1 test passed\nGATE_RESULT:PASS",
  },
  functionalTestGate: {
    passed: true,
    output: "1 test passed\nGATE_RESULT:PASS",
  },
  securityReview: {
    severity: "LOW",
    findings: [],
  },
};
