import { describe, it, expect, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("./config.js", () => ({ getAgents: vi.fn(() => []) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));

import { extractJSON } from "./planner.js";

describe("extractJSON", () => {
  it("extracts from fenced json block", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(extractJSON(input)).toBe('{"key": "value"}');
  });

  it("extracts from fenced block without language tag", () => {
    const input = '```\n{"key": "value"}\n```';
    expect(extractJSON(input)).toBe('{"key": "value"}');
  });

  it("extracts last fenced block when multiple exist", () => {
    const input = 'Some text\n```json\n{"first": true}\n```\nMore text\n```json\n{"second": true}\n```';
    expect(extractJSON(input)).toBe('{"second": true}');
  });

  it("extracts raw JSON object", () => {
    const input = 'Some text before {"valid": true, "goals": ["a"]} some text after';
    const result = extractJSON(input);
    expect(JSON.parse(result)).toEqual({ valid: true, goals: ["a"] });
  });

  it("extracts JSON from output with leading text", () => {
    const input = 'Here is my analysis:\n\n{"valid": true, "goals": ["goal1"], "tasks": ["task1"], "constraints": ["c1"], "dod": ["d1"]}';
    const result = extractJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);
    expect(parsed.goals).toEqual(["goal1"]);
  });

  it("handles nested braces in raw JSON", () => {
    const input = '{"outer": {"inner": "value"}}';
    const result = extractJSON(input);
    expect(JSON.parse(result)).toEqual({ outer: { inner: "value" } });
  });

  it("returns trimmed input when no JSON found", () => {
    const input = "  no json here  ";
    expect(extractJSON(input)).toBe("no json here");
  });

  it("handles exact fenced block (whole string)", () => {
    const input = '```json\n{"exact": true}\n```';
    expect(extractJSON(input)).toBe('{"exact": true}');
  });

  it("extracts multiline fenced JSON", () => {
    const input = '```json\n{\n  "goals": [\n    "a",\n    "b"\n  ]\n}\n```';
    const result = extractJSON(input);
    expect(JSON.parse(result)).toEqual({ goals: ["a", "b"] });
  });

  it("handles empty input", () => {
    expect(extractJSON("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(extractJSON("   ")).toBe("");
  });
});
