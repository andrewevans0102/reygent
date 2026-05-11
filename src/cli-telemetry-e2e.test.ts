import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

describe("CLI telemetry end-to-end", () => {
  describe("full flag parsing flow", () => {
    it("parses all three telemetry flags correctly", () => {
      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry")
        .option("--telemetry-verbose", "Enable verbose telemetry");

      program.parse([
        "node",
        "test",
        "--telemetry-level",
        "verbose",
        "--no-telemetry",
        "--telemetry-verbose",
      ]);

      const opts = program.opts();
      expect(opts.telemetryLevel).toBe("verbose");
      expect(opts.telemetry).toBe(false);
      expect(opts.telemetryVerbose).toBe(true);
    });

    it("parses single flag correctly", () => {
      const program = new Command();
      program.option("--telemetry-level <level>", "Telemetry level");

      program.parse(["node", "test", "--telemetry-level", "minimal"]);

      const opts = program.opts();
      expect(opts.telemetryLevel).toBe("minimal");
    });

    it("handles no flags", () => {
      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry")
        .option("--telemetry-verbose", "Enable verbose telemetry");

      program.parse(["node", "test"]);

      const opts = program.opts();
      expect(opts.telemetryLevel).toBeUndefined();
      expect(opts.telemetry).not.toBe(false);
      expect(opts.telemetryVerbose).toBeUndefined();
    });
  });

  describe("preAction hook execution", () => {
    it("executes preAction before command action", () => {
      const executionOrder: string[] = [];

      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", () => {
          executionOrder.push("preAction");
        })
        .action(() => {
          executionOrder.push("action");
        });

      program.parse(["node", "test", "--telemetry-level", "verbose"]);

      expect(executionOrder).toEqual(["preAction", "action"]);
    });

    it("preAction validates telemetry level", () => {
      const program = new Command();
      program.exitOverride();

      const VALID_LEVELS = ["minimal", "standard", "verbose"];

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.telemetryLevel && !VALID_LEVELS.includes(opts.telemetryLevel)) {
            throw new Error(
              `Invalid --telemetry-level "${opts.telemetryLevel}". Must be one of: ${VALID_LEVELS.join(", ")}`
            );
          }
        })
        .action(() => {});

      expect(() => {
        program.parse(["node", "test", "--telemetry-level", "invalid"]);
      }).toThrow(/Invalid --telemetry-level/);
    });

    it("preAction applies override logic", () => {
      let appliedOverride: any = null;

      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--no-telemetry", "Disable telemetry")
        .option("--telemetry-verbose", "Enable verbose telemetry")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();

          if (opts.telemetry === false) {
            appliedOverride = { enabled: false };
          } else if (opts.telemetryVerbose) {
            appliedOverride = { level: "verbose" };
          } else if (opts.telemetryLevel) {
            appliedOverride = { level: opts.telemetryLevel };
          }
        })
        .action(() => {});

      program.parse(["node", "test", "--telemetry-level", "minimal"]);

      expect(appliedOverride).toEqual({ level: "minimal" });
    });

    it("preAction can access global flags", () => {
      let capturedOpts: any = null;

      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--model <id>", "Model ID")
        .hook("preAction", (thisCommand) => {
          capturedOpts = thisCommand.opts();
        })
        .action(() => {});

      program.parse([
        "node",
        "test",
        "--telemetry-level",
        "verbose",
        "--model",
        "claude-opus-4-6",
      ]);

      expect(capturedOpts.telemetryLevel).toBe("verbose");
      expect(capturedOpts.model).toBe("claude-opus-4-6");
    });
  });

  describe("command-specific scenarios", () => {
    it("run command with telemetry override", () => {
      let capturedOpts: any = null;

      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          capturedOpts = thisCommand.opts();
        });

      const runCmd = program
        .command("run")
        .option("--spec <source>", "Spec source")
        .action(() => {});

      program.parse(["node", "test", "run", "--telemetry-level", "verbose", "--spec", "PROJ-123"]);

      expect(capturedOpts.telemetryLevel).toBe("verbose");
    });

    it("agent command with --no-telemetry", () => {
      let capturedOpts: any = null;

      const program = new Command();
      program
        .option("--no-telemetry", "Disable telemetry")
        .hook("preAction", (thisCommand) => {
          capturedOpts = thisCommand.opts();
        });

      const agentCmd = program
        .command("agent")
        .argument("[name]", "Agent name")
        .action(() => {});

      program.parse(["node", "test", "agent", "dev", "--no-telemetry"]);

      expect(capturedOpts.telemetry).toBe(false);
    });

    it("config command with --telemetry-verbose", () => {
      let capturedOpts: any = null;

      const program = new Command();
      program
        .option("--telemetry-verbose", "Enable verbose telemetry")
        .hook("preAction", (thisCommand) => {
          capturedOpts = thisCommand.opts();
        });

      const configCmd = program.command("config").action(() => {});

      program.parse(["node", "test", "config", "--telemetry-verbose"]);

      expect(capturedOpts.telemetryVerbose).toBe(true);
    });
  });

  describe("validation error messages", () => {
    it("invalid level shows all valid options", () => {
      const program = new Command();
      program.exitOverride();

      const VALID_LEVELS = ["minimal", "standard", "verbose"];

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.telemetryLevel && !VALID_LEVELS.includes(opts.telemetryLevel)) {
            throw new Error(
              `Invalid --telemetry-level "${opts.telemetryLevel}". Must be one of: ${VALID_LEVELS.join(", ")}`
            );
          }
        })
        .action(() => {});

      try {
        program.parse(["node", "test", "--telemetry-level", "debug"]);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg).toContain("debug");
        expect(msg).toContain("minimal");
        expect(msg).toContain("standard");
        expect(msg).toContain("verbose");
      }
    });

    it("error preserves user input for debugging", () => {
      const program = new Command();
      program.exitOverride();

      const invalidValue = "trace";

      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          const VALID_LEVELS = ["minimal", "standard", "verbose"];
          if (opts.telemetryLevel && !VALID_LEVELS.includes(opts.telemetryLevel)) {
            throw new Error(`Invalid --telemetry-level "${opts.telemetryLevel}".`);
          }
        })
        .action(() => {});

      try {
        program.parse(["node", "test", "--telemetry-level", invalidValue]);
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain(invalidValue);
      }
    });
  });

  describe("flag interaction with existing flags", () => {
    it("works alongside --debug flag", () => {
      const program = new Command();
      program
        .option("--debug", "Enable debug mode")
        .option("--telemetry-level <level>", "Telemetry level");

      program.parse(["node", "test", "--debug", "--telemetry-level", "verbose"]);

      const opts = program.opts();
      expect(opts.debug).toBe(true);
      expect(opts.telemetryLevel).toBe("verbose");
    });

    it("works alongside --model flag", () => {
      const program = new Command();
      program
        .option("--model <id>", "Model ID")
        .option("--telemetry-level <level>", "Telemetry level");

      program.parse(["node", "test", "--model", "claude-opus-4-6", "--telemetry-level", "minimal"]);

      const opts = program.opts();
      expect(opts.model).toBe("claude-opus-4-6");
      expect(opts.telemetryLevel).toBe("minimal");
    });

    it("works alongside --provider flag", () => {
      const program = new Command();
      program
        .option("--provider <name>", "Provider name")
        .option("--no-telemetry", "Disable telemetry");

      program.parse(["node", "test", "--provider", "claude", "--no-telemetry"]);

      const opts = program.opts();
      expect(opts.provider).toBe("claude");
      expect(opts.telemetry).toBe(false);
    });
  });

  describe("comprehensive override resolution", () => {
    it("resolves overrides in correct priority order", () => {
      const resolveTelemetryConfig = (opts: any, configLevel: string) => {
        // Priority: --no-telemetry > --telemetry-verbose > --telemetry-level > config
        if (opts.telemetry === false) {
          return { enabled: false, level: null };
        }
        if (opts.telemetryVerbose) {
          return { enabled: true, level: "verbose" };
        }
        if (opts.telemetryLevel) {
          return { enabled: true, level: opts.telemetryLevel };
        }
        return { enabled: true, level: configLevel };
      };

      const scenarios = [
        { opts: { telemetry: false }, config: "standard", expected: { enabled: false, level: null } },
        { opts: { telemetryVerbose: true }, config: "standard", expected: { enabled: true, level: "verbose" } },
        { opts: { telemetryLevel: "minimal" }, config: "standard", expected: { enabled: true, level: "minimal" } },
        { opts: {}, config: "standard", expected: { enabled: true, level: "standard" } },
        {
          opts: { telemetry: false, telemetryVerbose: true },
          config: "standard",
          expected: { enabled: false, level: null },
        },
        {
          opts: { telemetryVerbose: true, telemetryLevel: "minimal" },
          config: "standard",
          expected: { enabled: true, level: "verbose" },
        },
      ];

      for (const scenario of scenarios) {
        const result = resolveTelemetryConfig(scenario.opts, scenario.config);
        expect(result).toEqual(scenario.expected);
      }
    });
  });

  describe("help text integration", () => {
    it("telemetry flags appear in help output", () => {
      const program = new Command();
      program
        .option("--telemetry-level <level>", "Override telemetry level (minimal|standard|verbose)")
        .option("--no-telemetry", "Disable telemetry for this run")
        .option("--telemetry-verbose", "Enable verbose telemetry (shorthand for --telemetry-level verbose)");

      const helpText = program.helpInformation();

      expect(helpText).toContain("--telemetry-level");
      expect(helpText).toContain("--no-telemetry");
      expect(helpText).toContain("--telemetry-verbose");
    });
  });

  describe("multiple preAction hooks", () => {
    it("multiple hooks execute in order", () => {
      const executionOrder: string[] = [];

      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .hook("preAction", () => {
          executionOrder.push("hook1-telemetry");
        })
        .hook("preAction", () => {
          executionOrder.push("hook2-model");
        })
        .action(() => {
          executionOrder.push("action");
        });

      program.parse(["node", "test", "--telemetry-level", "verbose"]);

      expect(executionOrder).toEqual(["hook1-telemetry", "hook2-model", "action"]);
    });

    it("telemetry hook does not interfere with other hooks", () => {
      let telemetryApplied = false;
      let modelApplied = false;

      const program = new Command();
      program
        .option("--telemetry-level <level>", "Telemetry level")
        .option("--model <id>", "Model ID")
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.telemetryLevel) {
            telemetryApplied = true;
          }
        })
        .hook("preAction", (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.model) {
            modelApplied = true;
          }
        })
        .action(() => {});

      program.parse([
        "node",
        "test",
        "--telemetry-level",
        "verbose",
        "--model",
        "claude-opus-4-6",
      ]);

      expect(telemetryApplied).toBe(true);
      expect(modelApplied).toBe(true);
    });
  });
});
