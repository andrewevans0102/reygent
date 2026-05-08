import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must mock before importing
vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("../config.js", () => ({
  getAgents: vi.fn(),
}));

vi.mock("../debug.js", () => ({
  isDebug: vi.fn(() => false),
}));

vi.mock("../model.js", () => ({
  resolveModel: vi.fn(() => Promise.resolve("claude-3-5-sonnet-20241022")),
  resolveProvider: vi.fn(() => "anthropic"),
  validateModel: vi.fn((m) => m),
}));

vi.mock("../providers/index.js", () => ({
  getProvider: vi.fn(() => ({
    spawnInteractive: vi.fn(() => Promise.resolve(0)),
  })),
}));

vi.mock("../spec.js", () => ({
  loadSpec: vi.fn(),
  SpecError: class SpecError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SpecError";
    }
  },
}));

// Mock chalk
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

import { select } from "@inquirer/prompts";
import { getAgents } from "../config.js";
import { getProvider } from "../providers/index.js";
import { loadSpec, SpecError } from "../spec.js";
import { agentCommand } from "./agent.js";

const mockSelect = vi.mocked(select);
const mockGetAgents = vi.mocked(getAgents);
const mockGetProvider = vi.mocked(getProvider);
const mockLoadSpec = vi.mocked(loadSpec);

describe("agent command with --spec flag", () => {
  let testDir: string;
  let specPath: string;

  beforeEach(() => {
    vi.resetAllMocks();

    // Create temp dir for spec files
    testDir = join(tmpdir(), `reygent-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    specPath = join(testDir, "test-spec.md");

    mockGetAgents.mockReturnValue([
      {
        name: "dev",
        description: "Development agent",
        systemPrompt: "You are a dev agent.",
        provider: "anthropic",
      },
    ]);

    const mockSpawnInteractive = vi.fn(() => Promise.resolve(0));
    mockGetProvider.mockReturnValue({
      spawnInteractive: mockSpawnInteractive,
    });
  });

  it("passes spec content to agent system prompt when --spec provided", async () => {
    const specContent = "# Test Feature\n\nImplement user authentication.";
    writeFileSync(specPath, specContent);

    mockLoadSpec.mockResolvedValue({
      source: "markdown",
      title: "Test Feature",
      content: specContent,
    });

    const mockSpawnInteractive = vi.fn(() => Promise.resolve(0));
    mockGetProvider.mockReturnValue({
      spawnInteractive: mockSpawnInteractive,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", { spec: specPath });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockLoadSpec).toHaveBeenCalledWith(specPath);
    expect(mockSpawnInteractive).toHaveBeenCalledTimes(1);

    const systemPrompt = mockSpawnInteractive.mock.calls[0][0];
    expect(systemPrompt).toContain("You are a dev agent.");
    expect(systemPrompt).toContain("## Spec");
    expect(systemPrompt).toContain("**Title:** Test Feature");
    expect(systemPrompt).toContain("# Test Feature");
    expect(systemPrompt).toContain("Implement user authentication.");

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("works without --spec flag (backward compatibility)", async () => {
    const mockSpawnInteractive = vi.fn(() => Promise.resolve(0));
    mockGetProvider.mockReturnValue({
      spawnInteractive: mockSpawnInteractive,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", {});

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockLoadSpec).not.toHaveBeenCalled();
    expect(mockSpawnInteractive).toHaveBeenCalledTimes(1);

    const systemPrompt = mockSpawnInteractive.mock.calls[0][0];
    expect(systemPrompt).toBe("You are a dev agent.");
    expect(systemPrompt).not.toMatch(/## Spec/);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("handles spec file not found error", async () => {
    mockLoadSpec.mockRejectedValue(new SpecError("File not found: /nonexistent.md"));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", { spec: "/nonexistent.md" });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/Error:.*File not found/);

    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("handles empty spec file error", async () => {
    mockLoadSpec.mockRejectedValue(new SpecError("Spec file is empty: /empty.md"));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", { spec: "/empty.md" });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/Error:.*Spec file is empty/);

    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("passes Jira spec content to agent", async () => {
    mockLoadSpec.mockResolvedValue({
      source: "jira",
      issueKey: "PROJ-123",
      title: "Add login flow",
      content: "# Add login flow\n\nUser story details here.",
      issueType: "Story",
    });

    const mockSpawnInteractive = vi.fn(() => Promise.resolve(0));
    mockGetProvider.mockReturnValue({
      spawnInteractive: mockSpawnInteractive,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", { spec: "PROJ-123" });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockLoadSpec).toHaveBeenCalledWith("PROJ-123");
    expect(mockSpawnInteractive).toHaveBeenCalledTimes(1);

    const systemPrompt = mockSpawnInteractive.mock.calls[0][0];
    expect(systemPrompt).toContain("**Title:** Add login flow");
    expect(systemPrompt).toContain("# Add login flow");

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("passes Linear spec content to agent", async () => {
    mockLoadSpec.mockResolvedValue({
      source: "linear",
      issueId: "DT-456",
      title: "Fix auth bug",
      content: "# Fix auth bug\n\nToken expiry check broken.",
      labels: ["bug", "urgent"],
    });

    const mockSpawnInteractive = vi.fn(() => Promise.resolve(0));
    mockGetProvider.mockReturnValue({
      spawnInteractive: mockSpawnInteractive,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", { spec: "https://linear.app/team/DT-456" });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockLoadSpec).toHaveBeenCalledWith("https://linear.app/team/DT-456");
    expect(mockSpawnInteractive).toHaveBeenCalledTimes(1);

    const systemPrompt = mockSpawnInteractive.mock.calls[0][0];
    expect(systemPrompt).toContain("**Title:** Fix auth bug");
    expect(systemPrompt).toContain("# Fix auth bug");

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("prompts for agent selection when name not provided", async () => {
    mockSelect.mockResolvedValue({
      name: "qa",
      description: "QA agent",
      systemPrompt: "You are QA.",
      provider: "anthropic",
    });

    const specContent = "# Test Spec\n\nContent here.";
    writeFileSync(specPath, specContent);

    mockLoadSpec.mockResolvedValue({
      source: "markdown",
      title: "Test Spec",
      content: specContent,
    });

    const mockSpawnInteractive = vi.fn(() => Promise.resolve(0));
    mockGetProvider.mockReturnValue({
      spawnInteractive: mockSpawnInteractive,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand(undefined, { spec: specPath });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockLoadSpec).toHaveBeenCalledWith(specPath);
    expect(mockSpawnInteractive).toHaveBeenCalledTimes(1);

    const systemPrompt = mockSpawnInteractive.mock.calls[0][0];
    expect(systemPrompt).toContain("You are QA.");
    expect(systemPrompt).toContain("## Spec");

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("handles invalid agent name with --spec provided", async () => {
    const specContent = "# Test Spec\n\nContent here.";
    writeFileSync(specPath, specContent);

    mockLoadSpec.mockResolvedValue({
      source: "markdown",
      title: "Test Spec",
      content: specContent,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("nonexistent", { spec: specPath });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/Unknown agent.*nonexistent/i);
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("handles getAgents returning empty array", async () => {
    mockGetAgents.mockReturnValue([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", {});

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/Unknown agent.*dev/i);
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("handles getAgents missing dev agent", async () => {
    mockGetAgents.mockReturnValue([
      {
        name: "qa",
        description: "QA agent",
        systemPrompt: "You are QA.",
        provider: "anthropic",
      },
    ]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await agentCommand("dev", {});

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/Unknown agent.*dev/i);
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
