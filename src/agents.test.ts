import { describe, it, expect } from "vitest";
import { builtinAgents, type AgentConfig } from "./agents.js";

describe("builtinAgents", () => {
  it("is a non-empty array", () => {
    expect(builtinAgents.length).toBeGreaterThan(0);
  });

  it("all agents have required fields", () => {
    for (const agent of builtinAgents) {
      expect(typeof agent.name).toBe("string");
      expect(agent.name.length).toBeGreaterThan(0);
      expect(typeof agent.description).toBe("string");
      expect(typeof agent.systemPrompt).toBe("string");
      expect(Array.isArray(agent.tools)).toBe(true);
      expect(typeof agent.role).toBe("string");
    }
  });

  it("agent names are unique", () => {
    const names = builtinAgents.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes expected agents", () => {
    const names = builtinAgents.map((a) => a.name);
    expect(names).toContain("dev");
    expect(names).toContain("qe");
    expect(names).toContain("planner");
    expect(names).toContain("security-reviewer");
    expect(names).toContain("pr-reviewer");
    expect(names).toContain("adhoc");
  });

  it("each agent has at least one tool", () => {
    for (const agent of builtinAgents) {
      expect(agent.tools.length).toBeGreaterThan(0);
    }
  });

  it("dev agent has write and bash tools", () => {
    const dev = builtinAgents.find((a) => a.name === "dev")!;
    expect(dev.tools).toContain("write");
    expect(dev.tools).toContain("bash");
  });

  it("security-reviewer is read-only (no write tool)", () => {
    const sr = builtinAgents.find((a) => a.name === "security-reviewer")!;
    expect(sr.tools).not.toContain("write");
    expect(sr.tools).toContain("read");
  });

  it("planner has role 'planner'", () => {
    const planner = builtinAgents.find((a) => a.name === "planner")!;
    expect(planner.role).toBe("planner");
  });

  it("roles match expected values", () => {
    const roleMap: Record<string, string> = {
      dev: "developer",
      qe: "quality-engineer",
      "security-reviewer": "security-reviewer",
      adhoc: "general",
      planner: "planner",
      "pr-reviewer": "reviewer",
    };
    for (const [name, role] of Object.entries(roleMap)) {
      const agent = builtinAgents.find((a) => a.name === name);
      expect(agent?.role).toBe(role);
    }
  });
});
