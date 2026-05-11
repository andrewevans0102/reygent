import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import chalk from "chalk";

/**
 * Test output formatting helpers for analyze commands
 */
describe("analyze output formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("failure pattern formatting", () => {
    it("should format failure pattern with chalk colors", () => {
      const formatFailurePattern = (
        rank: number,
        event: string,
        count: number
      ): string => {
        return `${chalk.bold(`${rank}.`)} ${chalk.red(event)} ${chalk.gray(`(${count} occurrences)`)}`;
      };

      const output = formatFailurePattern(1, "error.parse", 12);

      // Output contains ANSI color codes
      expect(output).toContain("error.parse");
      expect(output).toContain("12 occurrences");
    });

    it("should format agent-specific failures", () => {
      const formatAgentFailure = (agent: string, count: number): string => {
        return `  ${chalk.cyan("-")} Agents: ${chalk.yellow(agent)} ${chalk.gray(`(${count})`)}`;
      };

      const output = formatAgentFailure("spec-writer", 7);

      expect(output).toContain("spec-writer");
      expect(output).toContain("(7)");
    });

    it("should format recommendations with bullet points", () => {
      const formatRecommendation = (text: string): string => {
        return `${chalk.green("•")} ${text}`;
      };

      const output = formatRecommendation("spec-writer has high parse failures - review output format");

      expect(output).toContain("spec-writer has high parse failures");
    });
  });

  describe("success pattern formatting", () => {
    it("should format tool sequence with arrows", () => {
      const formatToolSequence = (
        sequence: string[],
        runs: number,
        successRate: number
      ): string => {
        const sequenceStr = sequence.join(` ${chalk.gray("→")} `);
        return `  ${chalk.bold(sequence[0])}: ${sequenceStr} ${chalk.gray(`(${runs} runs, ${successRate}% success)`)}`;
      };

      const output = formatToolSequence(
        ["read_spec", "analyze_deps", "write_spec"],
        45,
        95
      );

      expect(output).toContain("read_spec");
      expect(output).toContain("analyze_deps");
      expect(output).toContain("write_spec");
      expect(output).toContain("45 runs");
      expect(output).toContain("95% success");
    });

    it("should format agent performance metrics", () => {
      const formatAgentPerformance = (
        agent: string,
        model: string,
        successRate: number,
        avgDuration: number,
        avgCost: number
      ): string => {
        return [
          `  ${chalk.cyan(agent)} ${chalk.gray(`(${model})`)}:`,
          `${chalk.green(`${successRate}%`)} success,`,
          `avg duration ${chalk.yellow(`${avgDuration}s`)},`,
          `avg cost ${chalk.yellow(`$${avgCost.toFixed(2)}`)}`
        ].join(" ");
      };

      const output = formatAgentPerformance("spec-writer", "sonnet", 89, 45, 0.12);

      expect(output).toContain("spec-writer");
      expect(output).toContain("sonnet");
      expect(output).toContain("89%");
      expect(output).toContain("45s");
      expect(output).toContain("$0.12");
    });
  });

  describe("cost breakdown formatting", () => {
    it("should format total spend summary", () => {
      const formatTotalSpend = (
        total: number,
        successCost: number,
        failCost: number
      ): string => {
        const successPct = ((successCost / total) * 100).toFixed(0);
        const failPct = ((failCost / total) * 100).toFixed(0);

        return [
          `${chalk.bold("Total Spend:")} ${chalk.green(`$${total.toFixed(2)}`)}`,
          `Successful runs: ${chalk.green(`$${successCost.toFixed(2)}`)} ${chalk.gray(`(${successPct}%)`)}`,
          `Failed runs: ${chalk.red(`$${failCost.toFixed(2)}`)} ${chalk.gray(`(${failPct}% - wasted)`)}`
        ].join("\n");
      };

      const output = formatTotalSpend(42.18, 38.45, 3.73);

      expect(output).toContain("$42.18");
      expect(output).toContain("$38.45");
      expect(output).toContain("$3.73");
      expect(output).toContain("wasted");
    });

    it("should format cost by stage", () => {
      const formatStageCost = (
        stage: string,
        cost: number,
        totalCost: number,
        runs: number,
        avgPerRun: number
      ): string => {
        const percentage = ((cost / totalCost) * 100).toFixed(0);
        return `  ${chalk.cyan(stage.padEnd(12))} ${chalk.green(`$${cost.toFixed(2)}`)} ${chalk.gray(`(${percentage}%)`)} - ${runs} runs, avg ${chalk.yellow(`$${avgPerRun.toFixed(2)}/run`)}`;
      };

      const output = formatStageCost("spec", 12.34, 42.18, 136, 0.09);

      expect(output).toContain("spec");
      expect(output).toContain("$12.34");
      expect(output).toContain("136 runs");
      expect(output).toContain("$0.09/run");
    });

    it("should format optimization opportunities", () => {
      const formatOptimization = (description: string, savings: string): string => {
        return `${chalk.green("•")} ${description} ${chalk.bold.green(savings)}`;
      };

      const output = formatOptimization(
        "Switching reviewer from sonnet→haiku saves",
        "$0.03/run"
      );

      expect(output).toContain("sonnet→haiku");
      expect(output).toContain("$0.03/run");
    });

    it("should format expensive failure with run ID", () => {
      const formatExpensiveFailure = (
        rank: number,
        runId: string,
        cost: number,
        reason: string
      ): string => {
        return `  ${chalk.bold(`${rank}.`)} run ${chalk.yellow(runId)}: ${chalk.red(`$${cost.toFixed(2)}`)} ${chalk.gray(`(${reason})`)}`;
      };

      const output = formatExpensiveFailure(1, "abc-123", 0.85, "spec stage, gate retry loop");

      expect(output).toContain("abc-123");
      expect(output).toContain("$0.85");
      expect(output).toContain("gate retry loop");
    });
  });

  describe("agent analysis formatting", () => {
    it("should format agent summary header", () => {
      const formatAgentHeader = (agent: string): string => {
        return chalk.bold.cyan(`\n${agent}:`);
      };

      const output = formatAgentHeader("spec-writer");

      expect(output).toContain("spec-writer");
    });

    it("should format agent metrics", () => {
      const formatAgentMetrics = (
        runs: number,
        successCount: number,
        failCount: number,
        successRate: number,
        avgDuration: number,
        avgCost: number
      ): string => {
        return [
          `  Runs: ${chalk.bold(runs.toString())}`,
          `  Success rate: ${chalk.green(`${successRate}%`)} ${chalk.gray(`(${successCount} success, ${failCount} failures)`)}`,
          `  Avg duration: ${chalk.yellow(`${avgDuration}s`)}`,
          `  Avg cost: ${chalk.yellow(`$${avgCost.toFixed(2)}`)}`
        ].join("\n");
      };

      const output = formatAgentMetrics(136, 121, 15, 89, 45, 0.09);

      expect(output).toContain("136");
      expect(output).toContain("89%");
      expect(output).toContain("121 success");
      expect(output).toContain("15 failures");
      expect(output).toContain("45s");
      expect(output).toContain("$0.09");
    });

    it("should format model distribution", () => {
      const formatModelDistribution = (
        distributions: Array<{ model: string; percentage: number }>
      ): string => {
        return `  Model distribution: ${distributions.map(d =>
          `${chalk.cyan(d.model)} ${chalk.gray(`(${d.percentage}%)`)}`
        ).join(", ")}`;
      };

      const output = formatModelDistribution([
        { model: "sonnet", percentage: 90 },
        { model: "opus", percentage: 10 }
      ]);

      expect(output).toContain("sonnet");
      expect(output).toContain("90%");
      expect(output).toContain("opus");
      expect(output).toContain("10%");
    });

    it("should format top failures list", () => {
      const formatTopFailures = (
        failures: Array<{ type: string; count: number }>
      ): string => {
        return `  Top failures: ${failures.map(f =>
          `${chalk.red(f.type)} ${chalk.gray(`(${f.count})`)}`
        ).join(", ")}`;
      };

      const output = formatTopFailures([
        { type: "parse errors", count: 7 },
        { type: "gate retries", count: 5 }
      ]);

      expect(output).toContain("parse errors");
      expect(output).toContain("(7)");
      expect(output).toContain("gate retries");
      expect(output).toContain("(5)");
    });
  });

  describe("section headers and separators", () => {
    it("should format main section header", () => {
      const formatSectionHeader = (title: string, subtitle?: string): string => {
        const header = chalk.bold.white(`\n${title}`);
        return subtitle ? `${header} ${chalk.gray(subtitle)}` : header;
      };

      const output = formatSectionHeader("Failure Analysis", "(last 30 days, 47 runs)");

      expect(output).toContain("Failure Analysis");
      expect(output).toContain("last 30 days");
      expect(output).toContain("47 runs");
    });

    it("should format subsection header", () => {
      const formatSubsection = (title: string): string => {
        return chalk.bold(`\n${title}:`);
      };

      const output = formatSubsection("Top Failure Patterns");

      expect(output).toContain("Top Failure Patterns");
    });

    it("should format separator line", () => {
      const formatSeparator = (): string => {
        return chalk.gray("─".repeat(60));
      };

      const output = formatSeparator();

      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe("time window formatting", () => {
    it("should format relative time", () => {
      const formatRelativeTime = (timestamp: number): string => {
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

        if (diffDays === 0) return "today";
        if (diffDays === 1) return "1 day ago";
        return `${diffDays} days ago`;
      };

      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      expect(formatRelativeTime(twoDaysAgo)).toBe("2 days ago");

      const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
      expect(formatRelativeTime(oneDayAgo)).toBe("1 day ago");
    });

    it("should parse duration string to days", () => {
      const parseDuration = (duration: string): number => {
        const match = duration.match(/^(\d+)d$/);
        if (!match) throw new Error(`Invalid duration: ${duration}`);
        return Number.parseInt(match[1], 10);
      };

      expect(parseDuration("30d")).toBe(30);
      expect(parseDuration("7d")).toBe(7);
    });
  });

  describe("percentage formatting", () => {
    it("should format percentage with color based on value", () => {
      const formatPercentage = (value: number, threshold: number = 80): string => {
        const color = value >= threshold ? chalk.green : chalk.red;
        return color(`${value.toFixed(0)}%`);
      };

      const good = formatPercentage(95);
      const bad = formatPercentage(60);

      expect(good).toContain("95%");
      expect(bad).toContain("60%");
    });

    it("should format cost with dollar sign", () => {
      const formatCost = (cost: number): string => {
        return chalk.green(`$${cost.toFixed(2)}`);
      };

      expect(formatCost(42.18)).toContain("$42.18");
      expect(formatCost(0.09)).toContain("$0.09");
    });

    it("should format duration in seconds", () => {
      const formatDurationSeconds = (seconds: number): string => {
        return chalk.yellow(`${seconds}s`);
      };

      expect(formatDurationSeconds(45)).toContain("45s");
      expect(formatDurationSeconds(120)).toContain("120s");
    });
  });
});

/**
 * Test table formatting for structured output
 */
describe("analyze table formatting", () => {
  it("should format data as aligned columns", () => {
    interface TableRow {
      label: string;
      value: string;
      percentage: string;
    }

    const formatTable = (rows: TableRow[]): string => {
      const maxLabelLen = Math.max(...rows.map(r => r.label.length));
      const maxValueLen = Math.max(...rows.map(r => r.value.length));

      return rows.map(row => {
        const label = row.label.padEnd(maxLabelLen);
        const value = row.value.padStart(maxValueLen);
        return `  ${chalk.cyan(label)}  ${chalk.green(value)}  ${chalk.gray(row.percentage)}`;
      }).join("\n");
    };

    const rows: TableRow[] = [
      { label: "spec", value: "$12.34", percentage: "(29%)" },
      { label: "implement", value: "$24.56", percentage: "(58%)" },
      { label: "review", value: "$5.28", percentage: "(13%)" }
    ];

    const output = formatTable(rows);

    expect(output).toContain("spec");
    expect(output).toContain("$12.34");
    expect(output).toContain("29%");
  });

  it("should handle empty table gracefully", () => {
    const formatTable = (rows: string[][]): string => {
      if (rows.length === 0) {
        return chalk.gray("  No data available");
      }
      return rows.map(row => row.join(" ")).join("\n");
    };

    const output = formatTable([]);
    expect(output).toContain("No data available");
  });
});
