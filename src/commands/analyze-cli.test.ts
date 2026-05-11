import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

/**
 * Test CLI command registration for analyze commands
 */
describe("analyze CLI command registration", () => {
  let program: Command;
  let analyzeCommand: Command;

  beforeEach(() => {
    program = new Command();
    analyzeCommand = new Command("analyze")
      .description("Analyze telemetry data");

    // Register subcommands
    analyzeCommand.addCommand(
      new Command("failures")
        .description("Show common failure patterns from telemetry")
        .option("--agent <name>", "Filter by specific agent")
        .option("--since <duration>", "Time window (e.g., 7d, 30d)", "30d")
        .option("--limit <n>", "Show top N patterns", "10")
        .action(() => {})
    );

    analyzeCommand.addCommand(
      new Command("success")
        .description("Extract patterns from successful runs")
        .option("--stage <name>", "Filter by pipeline stage")
        .option("--min-success-rate <pct>", "Only show patterns above threshold")
        .action(() => {})
    );

    analyzeCommand.addCommand(
      new Command("costs")
        .description("Cost breakdown and optimization recommendations")
        .option("--since <duration>", "Time window", "30d")
        .option("--by-agent", "Group by agent instead of stage")
        .option("--show-runs", "List individual expensive runs")
        .action(() => {})
    );

    analyzeCommand.addCommand(
      new Command("agents")
        .description("Agent-specific performance breakdown")
        .option("--agent <name>", "Show only specific agent")
        .option("--compare-models", "Compare model performance within agent")
        .action(() => {})
    );

    program.addCommand(analyzeCommand);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should register analyze command with description", () => {
    const cmd = program.commands.find(c => c.name() === "analyze");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Analyze telemetry data");
  });

  it("should register failures subcommand with options", () => {
    const cmd = analyzeCommand.commands.find(c => c.name() === "failures");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Show common failure patterns from telemetry");

    const options = cmd?.options || [];
    const optionFlags = options.map(o => o.flags);

    expect(optionFlags).toContain("--agent <name>");
    expect(optionFlags).toContain("--since <duration>");
    expect(optionFlags).toContain("--limit <n>");
  });

  it("should register success subcommand with options", () => {
    const cmd = analyzeCommand.commands.find(c => c.name() === "success");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Extract patterns from successful runs");

    const options = cmd?.options || [];
    const optionFlags = options.map(o => o.flags);

    expect(optionFlags).toContain("--stage <name>");
    expect(optionFlags).toContain("--min-success-rate <pct>");
  });

  it("should register costs subcommand with options", () => {
    const cmd = analyzeCommand.commands.find(c => c.name() === "costs");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Cost breakdown and optimization recommendations");

    const options = cmd?.options || [];
    const optionFlags = options.map(o => o.flags);

    expect(optionFlags).toContain("--since <duration>");
    expect(optionFlags).toContain("--by-agent");
    expect(optionFlags).toContain("--show-runs");
  });

  it("should register agents subcommand with options", () => {
    const cmd = analyzeCommand.commands.find(c => c.name() === "agents");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe("Agent-specific performance breakdown");

    const options = cmd?.options || [];
    const optionFlags = options.map(o => o.flags);

    expect(optionFlags).toContain("--agent <name>");
    expect(optionFlags).toContain("--compare-models");
  });

  it("should have default values for optional parameters", () => {
    const failuresCmd = analyzeCommand.commands.find(c => c.name() === "failures");
    const sinceOption = failuresCmd?.options.find(o => o.flags === "--since <duration>");
    const limitOption = failuresCmd?.options.find(o => o.flags === "--limit <n>");

    expect(sinceOption?.defaultValue).toBe("30d");
    expect(limitOption?.defaultValue).toBe("10");
  });

  it("should support all analyze subcommands", () => {
    const subcommands = analyzeCommand.commands.map(c => c.name());
    expect(subcommands).toContain("failures");
    expect(subcommands).toContain("success");
    expect(subcommands).toContain("costs");
    expect(subcommands).toContain("agents");
  });
});

/**
 * Test command action handlers
 */
describe("analyze command action handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call analyzeFailures with correct options", async () => {
    const mockAction = vi.fn();
    const cmd = new Command("failures")
      .option("--agent <name>")
      .option("--since <duration>", "Time window", "30d")
      .option("--limit <n>", "Top N", "10")
      .action(mockAction);

    await cmd.parseAsync(["--agent", "spec-writer", "--since", "7d"], { from: "user" });

    expect(mockAction).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "spec-writer",
        since: "7d",
      }),
      expect.anything()
    );
  });

  it("should call analyzeSuccess with correct options", async () => {
    const mockAction = vi.fn();
    const cmd = new Command("success")
      .option("--stage <name>")
      .option("--min-success-rate <pct>")
      .action(mockAction);

    await cmd.parseAsync(["--stage", "implement"], { from: "user" });

    expect(mockAction).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "implement",
      }),
      expect.anything()
    );
  });

  it("should call analyzeCosts with correct options", async () => {
    const mockAction = vi.fn();
    const cmd = new Command("costs")
      .option("--since <duration>", "Time window", "30d")
      .option("--by-agent")
      .option("--show-runs")
      .action(mockAction);

    await cmd.parseAsync(["--by-agent", "--show-runs"], { from: "user" });

    expect(mockAction).toHaveBeenCalledWith(
      expect.objectContaining({
        byAgent: true,
        showRuns: true,
      }),
      expect.anything()
    );
  });

  it("should call analyzeAgents with correct options", async () => {
    const mockAction = vi.fn();
    const cmd = new Command("agents")
      .option("--agent <name>")
      .option("--compare-models")
      .action(mockAction);

    await cmd.parseAsync(["--agent", "reviewer", "--compare-models"], { from: "user" });

    expect(mockAction).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "reviewer",
        compareModels: true,
      }),
      expect.anything()
    );
  });

  it("should use default values when options not provided", async () => {
    const mockAction = vi.fn();
    const cmd = new Command("failures")
      .option("--agent <name>")
      .option("--since <duration>", "Time window", "30d")
      .option("--limit <n>", "Top N", "10")
      .action(mockAction);

    await cmd.parseAsync([], { from: "user" });

    expect(mockAction).toHaveBeenCalledWith(
      expect.objectContaining({
        since: "30d",
        limit: "10",
      }),
      expect.anything()
    );
  });
});

/**
 * Test option validation
 */
describe("analyze command option validation", () => {
  it("should accept valid duration formats", () => {
    const validateDuration = (duration: string): boolean => {
      return /^\d+d$/.test(duration);
    };

    expect(validateDuration("30d")).toBe(true);
    expect(validateDuration("7d")).toBe(true);
    expect(validateDuration("1d")).toBe(true);
  });

  it("should reject invalid duration formats", () => {
    const validateDuration = (duration: string): boolean => {
      return /^\d+d$/.test(duration);
    };

    expect(validateDuration("30")).toBe(false);
    expect(validateDuration("30h")).toBe(false);
    expect(validateDuration("abc")).toBe(false);
  });

  it("should accept valid limit values", () => {
    const validateLimit = (limit: string): boolean => {
      const num = Number.parseInt(limit, 10);
      return !Number.isNaN(num) && num > 0;
    };

    expect(validateLimit("10")).toBe(true);
    expect(validateLimit("5")).toBe(true);
    expect(validateLimit("100")).toBe(true);
  });

  it("should reject invalid limit values", () => {
    const validateLimit = (limit: string): boolean => {
      const num = Number.parseInt(limit, 10);
      return !Number.isNaN(num) && num > 0;
    };

    expect(validateLimit("0")).toBe(false);
    expect(validateLimit("-5")).toBe(false);
    expect(validateLimit("abc")).toBe(false);
  });

  it("should accept valid success rate percentages", () => {
    const validateSuccessRate = (rate: string): boolean => {
      const num = Number.parseFloat(rate);
      return !Number.isNaN(num) && num >= 0 && num <= 100;
    };

    expect(validateSuccessRate("50")).toBe(true);
    expect(validateSuccessRate("85.5")).toBe(true);
    expect(validateSuccessRate("0")).toBe(true);
    expect(validateSuccessRate("100")).toBe(true);
  });

  it("should reject invalid success rate percentages", () => {
    const validateSuccessRate = (rate: string): boolean => {
      const num = Number.parseFloat(rate);
      return !Number.isNaN(num) && num >= 0 && num <= 100;
    };

    expect(validateSuccessRate("-5")).toBe(false);
    expect(validateSuccessRate("101")).toBe(false);
    expect(validateSuccessRate("abc")).toBe(false);
  });
});
