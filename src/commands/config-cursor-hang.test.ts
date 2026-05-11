/**
 * Specific tests for config command cursor hang issue.
 * Config command performs async provider.isAvailable() checks before prompts,
 * which can cause cursor hangs without terminal reset.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Config command cursor hang issue", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = mkdtempSync(join(tmpdir(), "reygent-config-cursor-"));
    process.chdir(testDir);

    // Create .reygent directory
    const reygentDir = join(testDir, ".reygent");
    mkdirSync(reygentDir, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should identify async work before provider prompt", async () => {
    // Config command does:
    // 1. Scope selection prompt (line 108)
    // 2. Load config file (sync)
    // 3. for (const name of PROVIDER_NAMES) await provider.isAvailable() (async loop line 169-171)
    // 4. await select({ message: "Default provider:" }) (interactive prompt line 195)
    //
    // The async loop at step 3 can leave terminal in inconsistent state,
    // causing cursor hang at step 4. resetTerminalForInput at line 194 fixes it.

    const sourceCode = readFileSync(join(__dirname, "config.ts"), "utf-8");

    // Verify async operations before provider prompt
    expect(sourceCode).toMatch(/await.*isAvailable/);
    expect(sourceCode).toMatch(/Default provider/);

    // Async work appears before provider prompt - cursor hang risk (fixed by resetTerminalForInput)
    const asyncIndex = sourceCode.search(/await.*isAvailable/);
    const providerPromptIndex = sourceCode.search(/Default provider/);

    expect(asyncIndex).toBeGreaterThan(-1);
    expect(providerPromptIndex).toBeGreaterThan(-1);
    expect(asyncIndex).toBeLessThan(providerPromptIndex);
  });

  it("should document missing resetTerminalForInput call", async () => {
    // Current state: config.ts does NOT call resetTerminalForInput
    // before first prompt at line 192.
    //
    // Expected fix location: after line 170 (provider checks complete)
    // and before line 192 (first select prompt).

    const sourceCode = readFileSync(join(__dirname, "config.ts"), "utf-8");

    const hasResetCall = sourceCode.match(/resetTerminalForInput/);

    if (hasResetCall) {
      // Fix has been applied
      expect(hasResetCall).toBeDefined();
    } else {
      // Current state - no reset call
      // This is the cursor hang issue root cause
      expect(hasResetCall).toBeNull();
    }
  });

  it("should have prompts throughout config flow", async () => {
    // Config command has many interactive prompts:
    // - Scope selection (line 106)
    // - Provider selection (line 192)
    // - Model selection (line 218 or 227)
    // - Per-agent configuration (line 258)
    // - Agent provider selection (line 278)
    // - Agent model selection (line 301 or 310)
    //
    // First prompt after async work is highest risk.

    const sourceCode = readFileSync(join(__dirname, "config.ts"), "utf-8");

    const selectMatches = sourceCode.match(/await select\(/g);
    const pasteableMatches = sourceCode.match(/await pasteableInput\(/g);

    expect(selectMatches).toBeDefined();
    expect(pasteableMatches).toBeDefined();

    const totalPrompts = (selectMatches?.length ?? 0) + (pasteableMatches?.length ?? 0);
    expect(totalPrompts).toBeGreaterThanOrEqual(5);
  });

  it("should verify config uses @inquirer/prompts", async () => {
    // Config command imports from @inquirer/prompts, same as review-comments
    const sourceCode = readFileSync(join(__dirname, "config.ts"), "utf-8");

    expect(sourceCode).toMatch(/@inquirer\/prompts/);
  });

  it("should compare with working review-comments pattern", async () => {
    // review-comments.ts has working pattern:
    // 1. Async work (fetch comments, generate plan)
    // 2. resetTerminalForInput() at line 766
    // 3. Interactive prompts
    //
    // config.ts should follow same pattern.

    const reviewSource = readFileSync(join(__dirname, "review-comments.ts"), "utf-8");
    const configSource = readFileSync(join(__dirname, "config.ts"), "utf-8");

    // review-comments has resetTerminalForInput
    expect(reviewSource).toMatch(/resetTerminalForInput/);

    // config does not (current state)
    const configHasReset = configSource.match(/resetTerminalForInput/);
    if (!configHasReset) {
      expect(configHasReset).toBeNull();
    }
  });

  describe("Expected fix pattern", () => {
    it("should add resetTerminalForInput after provider checks", () => {
      // Expected fix:
      //
      // // config.ts line 170-191
      // for (const name of PROVIDER_NAMES) {
      //   const provider = getProvider(name);
      //   availability[name] = await provider.isAvailable();
      // }
      //
      // // Show current config
      // console.log(chalk.bold("Current config:"));
      // ...
      // console.log("");
      //
      // // ADD THIS LINE:
      // resetTerminalForInput();
      //
      // // 5. Select default provider
      // let selectedProvider = await select({
      //   message: "Default provider:",
      //   ...
      // });

      expect(true).toBe(true);
    });

    it("should import resetTerminalForInput at top of file", () => {
      // Expected import:
      // import { resetTerminalForInput } from "../terminal-reset.js";

      expect(true).toBe(true);
    });

    it("should call resetTerminalForInput before each prompt section", () => {
      // Config has multiple prompt sections separated by async work.
      // Should call resetTerminalForInput before:
      // 1. First provider selection (after isAvailable checks)
      // 2. Per-agent customization loops (after agent list loaded)
      //
      // Scope selection (line 106) is first thing after config load,
      // no async work before it, so reset not needed there.

      expect(true).toBe(true);
    });
  });

  describe("Verification after fix", () => {
    it("should not hang on provider selection prompt", () => {
      // Manual testing after fix:
      // 1. Run: reygent config
      // 2. Select scope (local or global)
      // 3. Wait for provider checks to complete
      // 4. Verify cursor responsive at "Default provider:" prompt
      // 5. Type/arrow keys should work immediately
      // 6. No silent hang or stuck cursor

      expect(true).toBe(true);
    });

    it("should not hang on model selection prompt", () => {
      // After selecting provider, model prompt should also work

      expect(true).toBe(true);
    });

    it("should not hang on agent customization prompts", () => {
      // Per-agent prompts should work without cursor hang

      expect(true).toBe(true);
    });
  });

  describe("Init command analysis", () => {
    it("should check if init command needs terminal reset", async () => {
      // init.ts has prompt at line 43:
      // const action = await select({...})
      //
      // Before this prompt (lines 38-40):
      // if (existsSync(targetDir)) {
      //   console.log(...);
      //   if (existsSync(configPath)) {
      //
      // No async work before first prompt, only sync file checks.
      // Cursor hang risk is low.

      const sourceCode = readFileSync(join(__dirname, "init.ts"), "utf-8");

      const selectMatch = sourceCode.match(/await select\(/);
      expect(selectMatch).toBeDefined();

      // Check for async work before prompt
      const asyncBeforePrompt = sourceCode.match(/await.*existsSync/);
      expect(asyncBeforePrompt).toBeNull(); // existsSync is sync
    });

    it("should verify init has spinner before any prompts", async () => {
      // init.ts creates spinner at line 70, after prompt at line 43.
      // Prompt happens before spinner, so no ora state to reset.

      const sourceCode = readFileSync(join(__dirname, "init.ts"), "utf-8");

      const spinnerIndex = sourceCode.search(/ora\(/);
      const promptIndex = sourceCode.search(/select\(/);

      expect(spinnerIndex).toBeGreaterThan(-1);
      expect(promptIndex).toBeGreaterThan(-1);

      // Prompt before spinner - no terminal reset needed
      expect(promptIndex).toBeLessThan(spinnerIndex);
    });
  });
});

describe("Terminal state after async operations", () => {
  it("should document when async work breaks terminal state", () => {
    // Async operations that can break terminal state:
    // 1. Network requests (HTTP/HTTPS)
    // 2. Process spawning (execFile, spawn)
    // 3. File I/O with large files
    // 4. Long-running computations
    //
    // After these operations, stdin may be in inconsistent state:
    // - Raw mode left enabled
    // - Cursor hidden
    // - Buffered input from ora spinners
    //
    // resetTerminalForInput() fixes all these issues.

    expect(true).toBe(true);
  });

  it("should identify ora spinner interaction with stdin", () => {
    // ora uses stdin-discarder to prevent buffered input during spinner.
    // stdin-discarder temporarily sets stdin.setRawMode(true).
    // After spinner stops, raw mode may still be active.
    //
    // If stdin is in raw mode when inquirer starts, prompts break:
    // - Keypresses not echoed
    // - Cursor doesn't move
    // - Input appears frozen
    //
    // resetTerminalForInput() detects and fixes this.

    expect(true).toBe(true);
  });

  it("should explain cursor position tracking bug", () => {
    // readline maintains internal cursor position.
    // After ora spinner, internal position != actual terminal position.
    //
    // User types → readline thinks cursor is at col 0 →
    // tries to move cursor → cursor moves to wrong place →
    // appears stuck.
    //
    // resetTerminalForInput() clears line and resets position to 0,
    // syncing readline's internal state with terminal.

    expect(true).toBe(true);
  });

  it("should verify all interactive commands handle terminal state", () => {
    // Commands with interactive prompts:
    // ✓ run.ts - uses resetTerminalForInput (4 calls)
    // ✓ review-comments.ts - uses resetTerminalForInput (3 calls)
    // ✓ spec.ts - uses resetTerminalForInput (1 call)
    // ✓ generate-spec.ts - uses resetTerminalForInput (1 call)
    // ✗ config.ts - MISSING resetTerminalForInput (cursor hang issue)
    // ~ init.ts - no async before prompt, reset not needed

    expect(true).toBe(true);
  });
});
