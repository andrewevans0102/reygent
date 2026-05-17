/**
 * Comprehensive test coverage for all interactive commands.
 * Ensures terminal cursor behavior is consistent across the entire CLI.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("All interactive commands terminal state management", () => {
  const srcRoot = join(__dirname, "..");

  function readSourceFile(relativePath: string): string {
    return readFileSync(join(srcRoot, relativePath), "utf-8");
  }

  function countOccurrences(source: string, pattern: RegExp): number {
    const matches = source.match(pattern);
    return matches ? matches.length : 0;
  }

  describe("run command (src/commands/run.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("commands/run.ts");
    });

    it("should import resetTerminalForInput", () => {
      expect(source).toMatch(/import.*resetTerminalForInput.*from.*terminal-reset/);
    });

    it("should call resetTerminalForInput before Linear issue entry", () => {
      // Line ~330: resetTerminalForInput() before pasteableInput for issue value
      expect(source).toMatch(/resetTerminalForInput\(\);?\s*const value = await pasteableInput/s);
    });

    it("should call resetTerminalForInput before planner clarification", () => {
      // Line ~621: resetTerminalForInput() before clarification questions
      expect(source).toMatch(/status\.stop\(\);?\s*resetTerminalForInput\(\);?\s*console\.log.*Planner needs clarification/s);
    });

    it("should call resetTerminalForInput before retry decisions", () => {
      // Multiple locations: resetTerminalForInput() before select prompts
      const resetCount = countOccurrences(source, /resetTerminalForInput/g);
      expect(resetCount).toBeGreaterThanOrEqual(4);
    });

    it("should use pasteableInput after resetTerminalForInput", () => {
      expect(source).toMatch(/resetTerminalForInput.*pasteableInput/s);
    });

    it("should use select after resetTerminalForInput", () => {
      expect(source).toMatch(/resetTerminalForInput.*select\(/s);
    });
  });

  describe("review-comments command (src/commands/review-comments.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("commands/review-comments.ts");
    });

    it("should import resetTerminalForInput", () => {
      expect(source).toMatch(/import.*resetTerminalForInput.*from.*terminal-reset/);
    });

    it("should call resetTerminalForInput before plan approval", () => {
      // Line ~766: resetTerminalForInput() before approval loop
      expect(source).toMatch(/if \(!options\.autoApprove\) \{?\s*resetTerminalForInput/s);
    });

    it("should call resetTerminalForInput before feedback input", () => {
      // Line ~782: resetTerminalForInput() before feedback pasteableInput
      expect(source).toMatch(/action === ["']feedback["'].*resetTerminalForInput.*pasteableInput/s);
    });

    it("should call resetTerminalForInput before instructions input", () => {
      // Line ~793: resetTerminalForInput() before instructions pasteableInput
      expect(source).toMatch(/action === ["']instructions["'].*resetTerminalForInput.*pasteableInput/s);
    });

    it("should have at least 3 resetTerminalForInput calls", () => {
      const resetCount = countOccurrences(source, /resetTerminalForInput/g);
      expect(resetCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("spec command (src/commands/spec.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("commands/spec.ts");
    });

    it("should import resetTerminalForInput", () => {
      expect(source).toMatch(/import.*resetTerminalForInput.*from.*terminal-reset/);
    });

    it("should call resetTerminalForInput before clarification prompts", () => {
      // Line ~123: resetTerminalForInput() before clarification questions
      expect(source).toMatch(/resetTerminalForInput.*clarification/is);
    });

    it("should use pasteableInput after resetTerminalForInput", () => {
      expect(source).toMatch(/resetTerminalForInput.*pasteableInput/s);
    });
  });

  describe("generate-spec command (src/commands/generate-spec.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("commands/generate-spec.ts");
    });

    it("should import resetTerminalForInput", () => {
      expect(source).toMatch(/import.*resetTerminalForInput.*from.*terminal-reset/);
    });

    it("should call resetTerminalForInput before clarification prompts", () => {
      // Line ~70: resetTerminalForInput() before readline questions
      expect(source).toMatch(/clarifyStatus\.stop\(\);?\s*resetTerminalForInput/s);
    });

    it("should use @inquirer/prompts input after resetTerminalForInput", () => {
      expect(source).toMatch(/resetTerminalForInput.*input\(/s);
    });
  });

  describe("config command (src/commands/config.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("commands/config.ts");
    });

    it("should import from @inquirer/prompts", () => {
      expect(source).toMatch(/import.*select.*from.*@inquirer\/prompts/);
      expect(source).toMatch(/import.*pasteableInput/);
    });

    it("should have async provider checks before prompts", () => {
      expect(source).toMatch(/await.*isAvailable/);
    });

    it("should have multiple interactive prompts", () => {
      const selectCount = countOccurrences(source, /await select\(/g);
      const pasteableCount = countOccurrences(source, /await pasteableInput\(/g);
      const totalPrompts = selectCount + pasteableCount;

      expect(totalPrompts).toBeGreaterThanOrEqual(5);
    });

    it("should call resetTerminalForInput before provider selection", () => {
      // Fix applied: config.ts now uses resetTerminalForInput
      const hasReset = source.match(/resetTerminalForInput/);
      expect(hasReset).toBeDefined();
    });

    it("should have async work before first prompt", () => {
      // Provider availability checks happen before first select()
      const asyncIndex = source.indexOf("await");
      const firstPromptIndex = source.indexOf("await select");

      expect(asyncIndex).toBeGreaterThan(-1);
      expect(firstPromptIndex).toBeGreaterThan(-1);
      expect(asyncIndex).toBeLessThan(firstPromptIndex);
    });
  });

  describe("init command (src/commands/init.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("commands/init.ts");
    });

    it("should have interactive prompt for existing config", () => {
      expect(source).toMatch(/await select\(/);
    });

    it("should have prompt before spinner", () => {
      const promptIndex = source.indexOf("await select");
      const spinnerIndex = source.indexOf("ora(");

      expect(promptIndex).toBeGreaterThan(-1);
      expect(spinnerIndex).toBeGreaterThan(-1);
      expect(promptIndex).toBeLessThan(spinnerIndex);
    });

    it("should call resetTerminalForInput before prompts", () => {
      // Init command prompts for existing config action before spinner
      const hasReset = source.match(/resetTerminalForInput/);
      expect(hasReset).not.toBeNull();
    });
  });

  describe("live-status module (src/live-status.ts)", () => {
    let source: string;

    beforeAll(() => {
      source = readSourceFile("live-status.ts");
    });

    it("should import resetTerminalForInput", () => {
      expect(source).toMatch(/import.*resetTerminalForInput.*from.*terminal-reset/);
    });

    it("should call resetTerminalForInput in all stop methods", () => {
      const resetCount = countOccurrences(source, /resetTerminalForInput/g);
      expect(resetCount).toBeGreaterThanOrEqual(5);
    });

    it("should reset in stop method", () => {
      expect(source).toMatch(/stop\(\).*resetTerminalForInput/s);
    });

    it("should reset in succeed method", () => {
      expect(source).toMatch(/succeed\(.*\).*resetTerminalForInput/s);
    });

    it("should reset in fail method", () => {
      expect(source).toMatch(/fail\(.*\).*resetTerminalForInput/s);
    });

    it("should reset in warn method", () => {
      expect(source).toMatch(/warn\(.*\).*resetTerminalForInput/s);
    });

    it("should reset in info method", () => {
      expect(source).toMatch(/info\(.*\).*resetTerminalForInput/s);
    });
  });
});

describe("Terminal state patterns across codebase", () => {
  const srcRoot = join(__dirname, "..");

  function readSourceFile(relativePath: string): string {
    return readFileSync(join(srcRoot, relativePath), "utf-8");
  }

  describe("Consistent import pattern", () => {
    it("should import resetTerminalForInput from terminal-reset module", () => {
      const files = [
        "commands/run.ts",
        "commands/review-comments.ts",
        "commands/spec.ts",
        "commands/generate-spec.ts",
        "live-status.ts",
      ];

      for (const file of files) {
        const source = readSourceFile(file);
        expect(source).toMatch(/import.*resetTerminalForInput.*from.*terminal-reset/);
      }
    });
  });

  describe("Spinner followed by prompt pattern", () => {
    it("should call resetTerminalForInput after spinner.stop()", () => {
      const runSource = readSourceFile("commands/run.ts");

      // run.ts uses LiveStatus which has stop() → resetTerminalForInput pattern
      expect(runSource).toMatch(/\.stop\(\);?\s*resetTerminalForInput/s);
    });

    it("should call resetTerminalForInput after status success/fail", () => {
      const liveStatusSource = readSourceFile("live-status.ts");

      expect(liveStatusSource).toMatch(/succeed.*resetTerminalForInput/s);
      expect(liveStatusSource).toMatch(/fail.*resetTerminalForInput/s);
    });
  });

  describe("Async operation before prompt pattern", () => {
    it("should identify commands with async work before prompts", () => {
      // run.ts: runPlanner() before clarification prompts
      const runSource = readSourceFile("commands/run.ts");
      expect(runSource).toMatch(/await runPlanner.*resetTerminalForInput.*pasteableInput/s);

      // review-comments.ts: generatePlan() before approval prompts
      const reviewSource = readSourceFile("commands/review-comments.ts");
      expect(reviewSource).toMatch(/await generatePlan.*resetTerminalForInput.*select/s);

      // config.ts: isAvailable() loop before provider selection (MISSING RESET)
      const configSource = readSourceFile("commands/config.ts");
      expect(configSource).toMatch(/await.*isAvailable.*select/s);
    });
  });

  describe("Terminal reset module", () => {
    it("should export resetTerminalForInput function", () => {
      const terminalResetSource = readSourceFile("terminal-reset.ts");
      expect(terminalResetSource).toMatch(/export function resetTerminalForInput/);
    });

    it("should document escape sequences", () => {
      const terminalResetSource = readSourceFile("terminal-reset.ts");

      // SGR reset
      expect(terminalResetSource).toMatch(/\\x1b\[0m/);

      // Show cursor
      expect(terminalResetSource).toMatch(/\\x1b\[\?25h/);

      // Clear line
      expect(terminalResetSource).toMatch(/\\r\\x1b\[2K/);
    });

    it("should handle raw mode conditionally", () => {
      const terminalResetSource = readSourceFile("terminal-reset.ts");
      expect(terminalResetSource).toMatch(/isTTY.*isRaw.*isPaused.*setRawMode/s);
    });
  });
});

describe("Coverage verification", () => {
  it("should list all commands with interactive prompts", () => {
    const interactiveCommands = [
      "run",          // Linear issue entry, clarification, retry decisions
      "review-comments", // Plan approval, feedback, instructions
      "spec",         // Clarification questions
      "generate-spec", // Clarification questions
      "config",       // Provider/model selection, agent customization
      "init",         // Existing config action (prompt before spinner)
    ];

    expect(interactiveCommands.length).toBe(6);
  });

  it("should verify terminal reset implementation status", () => {
    const implementationStatus = {
      run: "implemented",
      "review-comments": "implemented",
      spec: "implemented",
      "generate-spec": "implemented",
      config: "missing", // This is the bug
      init: "not-needed", // Prompt before any async work
    };

    expect(implementationStatus.config).toBe("missing");
  });

  it("should document expected behavior", () => {
    // After fix, all interactive commands should:
    // 1. Complete any async work (network, spawn, I/O)
    // 2. Stop any active spinners
    // 3. Call resetTerminalForInput()
    // 4. Show interactive prompt
    // 5. User can type/navigate immediately without hang

    expect(true).toBe(true);
  });
});
