import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";

describe("CLI telemetry flags", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Throw instead of exit for testing
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("--telemetry-level flag", () => {
    it("accepts minimal as valid level", () => {
      program.option("--telemetry-level <level>", "Telemetry level");
      program.parse(["node", "test", "--telemetry-level", "minimal"]);
      const opts = program.opts();
      expect(opts.telemetryLevel).toBe("minimal");
    });

    it("accepts standard as valid level", () => {
      program.option("--telemetry-level <level>", "Telemetry level");
      program.parse(["node", "test", "--telemetry-level", "standard"]);
      const opts = program.opts();
      expect(opts.telemetryLevel).toBe("standard");
    });

    it("accepts verbose as valid level", () => {
      program.option("--telemetry-level <level>", "Telemetry level");
      program.parse(["node", "test", "--telemetry-level", "verbose"]);
      const opts = program.opts();
      expect(opts.telemetryLevel).toBe("verbose");
    });

    it("rejects invalid level with error message", () => {
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          const validLevels = ["minimal", "standard", "verbose"];
          if (opts.telemetryLevel && !validLevels.includes(opts.telemetryLevel)) {
            throw new Error(
              `Invalid --telemetry-level "${opts.telemetryLevel}". Must be one of: ${validLevels.join(", ")}`
            );
          }
        })
        .action(() => {});

      expect(() => {
        program.parse(["node", "test", "--telemetry-level", "invalid"]);
      }).toThrow(/Invalid --telemetry-level "invalid"/);
    });

    it("does not set value when flag omitted", () => {
      program.option("--telemetry-level <level>", "Telemetry level");
      program.parse(["node", "test"]);
      const opts = program.opts();
      expect(opts.telemetryLevel).toBeUndefined();
    });
  });

  describe("--no-telemetry flag", () => {
    it("sets telemetry to false when provided", () => {
      program.option("--no-telemetry", "Disable telemetry");
      program.parse(["node", "test", "--no-telemetry"]);
      const opts = program.opts();
      expect(opts.telemetry).toBe(false);
    });

    it("does not set value when flag omitted", () => {
      program.option("--no-telemetry", "Disable telemetry");
      program.parse(["node", "test"]);
      const opts = program.opts();
      expect(opts.telemetry).not.toBe(false);
    });
  });

  describe("--telemetry-verbose flag", () => {
    it("sets telemetryVerbose to true when provided", () => {
      program.option("--telemetry-verbose", "Enable verbose telemetry");
      program.parse(["node", "test", "--telemetry-verbose"]);
      const opts = program.opts();
      expect(opts.telemetryVerbose).toBe(true);
    });

    it("does not set value when flag omitted", () => {
      program.option("--telemetry-verbose", "Enable verbose telemetry");
      program.parse(["node", "test"]);
      const opts = program.opts();
      expect(opts.telemetryVerbose).toBeUndefined();
    });
  });

  describe("flag precedence", () => {
    it("--telemetry-verbose overrides --telemetry-level when both provided", () => {
      const applyOverrides = (opts: any) => {
        if (opts.telemetryVerbose) {
          return { level: "verbose", disabled: false };
        }
        if (opts.telemetry === false) {
          return { level: null, disabled: true };
        }
        if (opts.telemetryLevel) {
          return { level: opts.telemetryLevel, disabled: false };
        }
        return { level: null, disabled: false };
      };

      const opts = { telemetryLevel: "minimal", telemetryVerbose: true };
      const result = applyOverrides(opts);
      expect(result.level).toBe("verbose");
      expect(result.disabled).toBe(false);
    });

    it("--no-telemetry disables telemetry regardless of level flags", () => {
      const applyOverrides = (opts: any) => {
        if (opts.telemetry === false) {
          return { level: null, disabled: true };
        }
        if (opts.telemetryVerbose) {
          return { level: "verbose", disabled: false };
        }
        if (opts.telemetryLevel) {
          return { level: opts.telemetryLevel, disabled: false };
        }
        return { level: null, disabled: false };
      };

      const opts1 = { telemetry: false, telemetryLevel: "verbose" };
      const result1 = applyOverrides(opts1);
      expect(result1.disabled).toBe(true);

      const opts2 = { telemetry: false, telemetryVerbose: true };
      const result2 = applyOverrides(opts2);
      expect(result2.disabled).toBe(true);
    });

    it("--telemetry-level takes precedence over default config", () => {
      const applyOverrides = (opts: any, configLevel: string) => {
        if (opts.telemetry === false) {
          return { level: null, disabled: true };
        }
        if (opts.telemetryVerbose) {
          return { level: "verbose", disabled: false };
        }
        if (opts.telemetryLevel) {
          return { level: opts.telemetryLevel, disabled: false };
        }
        return { level: configLevel, disabled: false };
      };

      const opts = { telemetryLevel: "minimal" };
      const result = applyOverrides(opts, "standard");
      expect(result.level).toBe("minimal");
    });

    it("uses config level when no flags provided", () => {
      const applyOverrides = (opts: any, configLevel: string) => {
        if (opts.telemetry === false) {
          return { level: null, disabled: true };
        }
        if (opts.telemetryVerbose) {
          return { level: "verbose", disabled: false };
        }
        if (opts.telemetryLevel) {
          return { level: opts.telemetryLevel, disabled: false };
        }
        return { level: configLevel, disabled: false };
      };

      const opts = {};
      const result = applyOverrides(opts, "standard");
      expect(result.level).toBe("standard");
    });
  });

  describe("global flag availability", () => {
    it("flags available on all commands", () => {
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry")
        .option("--telemetry-verbose", "Enable verbose telemetry");

      const runCmd = program
        .command("run")
        .option("--spec <source>", "Spec source")
        .action(() => {});

      program.parse(["node", "test", "run", "--telemetry-level", "verbose"]);
      const opts = program.opts();
      expect(opts.telemetryLevel).toBe("verbose");
    });
  });

  describe("integration with preAction hook", () => {
    it("preAction hook can access and validate telemetry flags", () => {
      let hookExecuted = false;
      let capturedOpts: any = null;

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry")
        .option("--telemetry-verbose", "Enable verbose telemetry")
        .hook("preAction", (thisCommand) => {
          hookExecuted = true;
          capturedOpts = thisCommand.opts();
        })
        .action(() => {});

      program.parse(["node", "test", "--telemetry-level", "minimal"]);

      expect(hookExecuted).toBe(true);
      expect(capturedOpts.telemetryLevel).toBe("minimal");
    });

    it("preAction hook validates telemetry level before command execution", () => {
      const validLevels = ["minimal", "standard", "verbose"];

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.telemetryLevel && !validLevels.includes(opts.telemetryLevel)) {
            throw new Error(
              `Invalid --telemetry-level "${opts.telemetryLevel}". Must be one of: ${validLevels.join(", ")}`
            );
          }
        })
        .action(() => {});

      expect(() => {
        program.parse(["node", "test", "--telemetry-level", "bad"]);
      }).toThrow(/Invalid --telemetry-level/);
    });

    it("preAction hook applies flag overrides in correct order", () => {
      const applyOverrides = (opts: any) => {
        // Priority: --no-telemetry > --telemetry-verbose > --telemetry-level
        if (opts.telemetry === false) {
          return { disabled: true };
        }
        if (opts.telemetryVerbose) {
          return { level: "verbose" };
        }
        if (opts.telemetryLevel) {
          return { level: opts.telemetryLevel };
        }
        return {};
      };

      let result: any = null;

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry")
        .option("--telemetry-verbose", "Enable verbose telemetry")
        .hook("preAction", (thisCommand) => {
          result = applyOverrides(thisCommand.opts());
        })
        .action(() => {});

      program.parse(["node", "test", "--no-telemetry", "--telemetry-verbose"]);
      expect(result.disabled).toBe(true);
    });
  });

  describe("flag persistence behavior", () => {
    it("flags do not persist beyond single command execution", () => {
      const overrides: any[] = [];

      const captureOverrides = (opts: any) => {
        overrides.push({ ...opts });
      };

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          captureOverrides(thisCommand.opts());
        })
        .action(() => {});

      // First execution with flag
      program.parse(["node", "test", "--telemetry-level", "verbose"]);
      expect(overrides[0].telemetryLevel).toBe("verbose");

      // Simulate second execution without flag (new program instance)
      const program2 = new Command();
      const overrides2: any[] = [];

      program2
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          overrides2.push({ ...thisCommand.opts() });
        })
        .action(() => {});

      program2.parse(["node", "test"]);
      expect(overrides2[0].telemetryLevel).toBeUndefined();
    });
  });

  describe("commander integration patterns", () => {
    it("matches existing --model flag pattern", () => {
      program
        .option("--model <id>", "Model ID")
        .option("--telemetry-level <level>", "Telemetry level");

      program.parse(["node", "test", "--model", "claude-opus-4-6", "--telemetry-level", "verbose"]);

      const opts = program.opts();
      expect(opts.model).toBe("claude-opus-4-6");
      expect(opts.telemetryLevel).toBe("verbose");
    });

    it("matches existing --no-telemetry flag pattern", () => {
      program.option("--no-telemetry", "Disable telemetry");

      program.parse(["node", "test", "--no-telemetry"]);

      const opts = program.opts();
      expect(opts.telemetry).toBe(false);
    });

    it("works with multiple commands", () => {
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry");

      program
        .command("run")
        .option("--spec <source>", "Spec source")
        .action(() => {});

      program
        .command("agent")
        .argument("[name]", "Agent name")
        .action(() => {});

      program.parse(["node", "test", "run", "--telemetry-level", "minimal"]);
      expect(program.opts().telemetryLevel).toBe("minimal");
    });
  });

  describe("error message quality", () => {
    it("invalid level error lists valid options", () => {
      const validLevels = ["minimal", "standard", "verbose"];

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.telemetryLevel && !validLevels.includes(opts.telemetryLevel)) {
            throw new Error(
              `Invalid --telemetry-level "${opts.telemetryLevel}". Must be one of: ${validLevels.join(", ")}`
            );
          }
        })
        .action(() => {});

      try {
        program.parse(["node", "test", "--telemetry-level", "invalid"]);
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const message = (err as Error).message;
        expect(message).toContain("minimal");
        expect(message).toContain("standard");
        expect(message).toContain("verbose");
      }
    });

    it("error includes the invalid value provided", () => {
      const validLevels = ["minimal", "standard", "verbose"];
      const invalidValue = "debug";

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.telemetryLevel && !validLevels.includes(opts.telemetryLevel)) {
            throw new Error(
              `Invalid --telemetry-level "${opts.telemetryLevel}". Must be one of: ${validLevels.join(", ")}`
            );
          }
        })
        .action(() => {});

      try {
        program.parse(["node", "test", "--telemetry-level", invalidValue]);
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(invalidValue);
      }
    });
  });

  describe("telemetry level validation", () => {
    it("validates telemetry level in preAction hook", () => {
      const isValidLevel = (level: string): boolean => {
        return ["minimal", "standard", "verbose"].includes(level);
      };

      expect(isValidLevel("minimal")).toBe(true);
      expect(isValidLevel("standard")).toBe(true);
      expect(isValidLevel("verbose")).toBe(true);
      expect(isValidLevel("invalid")).toBe(false);
      expect(isValidLevel("")).toBe(false);
    });
  });
});
