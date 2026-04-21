import { describe, it, expect } from "vitest";
import { PIPELINE, TaskError } from "./task.js";

describe("PIPELINE", () => {
  it("is a non-empty array", () => {
    expect(PIPELINE.length).toBeGreaterThan(0);
  });

  it("has correct stage order", () => {
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

  it("each stage has name, description, execution", () => {
    for (const stage of PIPELINE) {
      expect(typeof stage.name).toBe("string");
      expect(stage.name.length).toBeGreaterThan(0);
      expect(typeof stage.description).toBe("string");
      expect(stage.execution).toBeDefined();
      expect(typeof stage.execution.kind).toBe("string");
    }
  });

  it("plan stage is single agent", () => {
    const plan = PIPELINE.find((s) => s.name === "plan")!;
    expect(plan.execution.kind).toBe("agent");
    if (plan.execution.kind === "agent") {
      expect(plan.execution.agent).toBe("planner");
    }
  });

  it("implement stage is parallel", () => {
    const impl = PIPELINE.find((s) => s.name === "implement")!;
    expect(impl.execution.kind).toBe("parallel");
    if (impl.execution.kind === "parallel") {
      expect(impl.execution.agents).toContain("dev");
      expect(impl.execution.agents).toContain("qe");
    }
  });

  it("gate stages have kind 'gate'", () => {
    const gates = PIPELINE.filter((s) => s.name.startsWith("gate-"));
    expect(gates.length).toBe(2);
    for (const g of gates) {
      expect(g.execution.kind).toBe("gate");
    }
  });

  it("gate-unit-tests references dev agent", () => {
    const gate = PIPELINE.find((s) => s.name === "gate-unit-tests")!;
    if (gate.execution.kind === "gate") {
      expect(gate.execution.agent).toBe("dev");
      expect(gate.execution.condition).toBe("unit-tests-pass");
    }
  });

  it("gate-functional-tests references qe agent", () => {
    const gate = PIPELINE.find((s) => s.name === "gate-functional-tests")!;
    if (gate.execution.kind === "gate") {
      expect(gate.execution.agent).toBe("qe");
      expect(gate.execution.condition).toBe("functional-tests-pass");
    }
  });
});

describe("TaskError", () => {
  it("is an instance of Error", () => {
    const err = new TaskError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name TaskError", () => {
    const err = new TaskError("boom");
    expect(err.name).toBe("TaskError");
  });

  it("preserves message", () => {
    const err = new TaskError("something broke");
    expect(err.message).toBe("something broke");
  });

  it("has a stack trace", () => {
    const err = new TaskError("trace");
    expect(err.stack).toBeDefined();
  });
});
