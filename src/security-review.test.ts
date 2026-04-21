import { describe, it, expect, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("./config.js", () => ({ getAgents: vi.fn(() => []) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));
vi.mock("./implement.js", () => ({ spawnAgent: vi.fn() }));

import {
  severityAtOrAbove,
  extractSecurityReviewOutput,
  formatFindings,
} from "./security-review.js";
import type { Severity, SecurityFinding } from "./task.js";

describe("severityAtOrAbove", () => {
  it("CRITICAL >= CRITICAL", () => {
    expect(severityAtOrAbove("CRITICAL", "CRITICAL")).toBe(true);
  });

  it("HIGH >= HIGH", () => {
    expect(severityAtOrAbove("HIGH", "HIGH")).toBe(true);
  });

  it("CRITICAL >= LOW", () => {
    expect(severityAtOrAbove("CRITICAL", "LOW")).toBe(true);
  });

  it("LOW < HIGH", () => {
    expect(severityAtOrAbove("LOW", "HIGH")).toBe(false);
  });

  it("MEDIUM < CRITICAL", () => {
    expect(severityAtOrAbove("MEDIUM", "CRITICAL")).toBe(false);
  });

  it("HIGH >= MEDIUM", () => {
    expect(severityAtOrAbove("HIGH", "MEDIUM")).toBe(true);
  });

  it("LOW >= LOW", () => {
    expect(severityAtOrAbove("LOW", "LOW")).toBe(true);
  });

  it("MEDIUM >= LOW", () => {
    expect(severityAtOrAbove("MEDIUM", "LOW")).toBe(true);
  });
});

describe("extractSecurityReviewOutput", () => {
  it("extracts valid output", () => {
    const input = JSON.stringify({
      severity: "HIGH",
      findings: [
        {
          severity: "HIGH",
          description: "SQL injection",
          location: { file: "src/db.ts", line: 42 },
        },
      ],
    });
    const result = extractSecurityReviewOutput(input);
    expect(result.severity).toBe("HIGH");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].description).toBe("SQL injection");
    expect(result.findings[0].location?.file).toBe("src/db.ts");
    expect(result.findings[0].location?.line).toBe(42);
  });

  it("extracts empty findings", () => {
    const input = JSON.stringify({ severity: "LOW", findings: [] });
    const result = extractSecurityReviewOutput(input);
    expect(result.severity).toBe("LOW");
    expect(result.findings).toEqual([]);
  });

  it("handles finding without location", () => {
    const input = JSON.stringify({
      severity: "MEDIUM",
      findings: [{ severity: "MEDIUM", description: "Weak config" }],
    });
    const result = extractSecurityReviewOutput(input);
    expect(result.findings[0].location).toBeUndefined();
  });

  it("handles location without line", () => {
    const input = JSON.stringify({
      severity: "LOW",
      findings: [
        {
          severity: "LOW",
          description: "Info",
          location: { file: "src/x.ts" },
        },
      ],
    });
    const result = extractSecurityReviewOutput(input);
    expect(result.findings[0].location?.file).toBe("src/x.ts");
    expect(result.findings[0].location?.line).toBeUndefined();
  });

  it("extracts from fenced block", () => {
    const input = 'Analysis:\n```json\n{"severity": "LOW", "findings": []}\n```';
    const result = extractSecurityReviewOutput(input);
    expect(result.severity).toBe("LOW");
  });

  it("throws on no JSON", () => {
    expect(() => extractSecurityReviewOutput("no json")).toThrow(/failed to extract/);
  });

  it("throws on invalid severity", () => {
    const input = JSON.stringify({ severity: "ULTRA", findings: [] });
    expect(() => extractSecurityReviewOutput(input)).toThrow(/invalid.*severity/i);
  });

  it("throws when findings not array", () => {
    const input = JSON.stringify({ severity: "LOW", findings: "nope" });
    expect(() => extractSecurityReviewOutput(input)).toThrow();
  });

  it("throws on finding with invalid severity", () => {
    const input = JSON.stringify({
      severity: "HIGH",
      findings: [{ severity: "MEGA", description: "bad" }],
    });
    expect(() => extractSecurityReviewOutput(input)).toThrow(/invalid severity/);
  });

  it("throws on finding missing description", () => {
    const input = JSON.stringify({
      severity: "HIGH",
      findings: [{ severity: "HIGH" }],
    });
    expect(() => extractSecurityReviewOutput(input)).toThrow(/missing description/);
  });
});

describe("formatFindings", () => {
  it("returns no findings message for empty array", () => {
    const result = formatFindings([], "HIGH");
    expect(result).toContain("No findings");
  });

  it("formats a finding with location", () => {
    const findings: SecurityFinding[] = [
      { severity: "HIGH", description: "XSS bug", location: { file: "app.ts", line: 10 } },
    ];
    const result = formatFindings(findings, "HIGH");
    expect(result).toContain("HIGH");
    expect(result).toContain("XSS bug");
    expect(result).toContain("app.ts:10");
  });

  it("formats finding without location", () => {
    const findings: SecurityFinding[] = [
      { severity: "LOW", description: "Minor issue" },
    ];
    const result = formatFindings(findings, "HIGH");
    expect(result).toContain("Minor issue");
  });

  it("marks blocking findings", () => {
    const findings: SecurityFinding[] = [
      { severity: "CRITICAL", description: "Bad" },
      { severity: "LOW", description: "OK" },
    ];
    const result = formatFindings(findings, "HIGH");
    // CRITICAL >= HIGH should be marked as blocking
    expect(result).toContain("!!");
  });
});
