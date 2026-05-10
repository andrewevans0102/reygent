import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shouldPromptForTelemetry, promptForTelemetryOptIn } from "./prompt.js";
import * as config from "../config.js";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

describe("shouldPromptForTelemetry", () => {
  let tmpDir: string;
  let findLocalConfigDirSpy: ReturnType<typeof vi.spyOn>;
  let resolveGlobalConfigPathSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `reygent-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    findLocalConfigDirSpy = vi.spyOn(config, "findLocalConfigDir");
    resolveGlobalConfigPathSpy = vi.spyOn(config, "resolveGlobalConfigPath");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns true when no config file exists", () => {
    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(join(tmpDir, "nonexistent", "config.json"));

    expect(shouldPromptForTelemetry()).toBe(true);
  });

  it("returns true when config exists but telemetry field is missing", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ provider: "claude" }), "utf-8");

    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(configPath);

    expect(shouldPromptForTelemetry()).toBe(true);
  });

  it("returns true when config exists but telemetry.enabled is undefined", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "claude",
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }),
      "utf-8"
    );

    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(configPath);

    expect(shouldPromptForTelemetry()).toBe(true);
  });

  it("returns false when telemetry.enabled is true", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "claude",
        telemetry: {
          enabled: true,
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }),
      "utf-8"
    );

    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(configPath);

    expect(shouldPromptForTelemetry()).toBe(false);
  });

  it("returns false when telemetry.enabled is false", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "claude",
        telemetry: {
          enabled: false,
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }),
      "utf-8"
    );

    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(configPath);

    expect(shouldPromptForTelemetry()).toBe(false);
  });

  it("prefers local config over global config", () => {
    const localDir = join(tmpDir, "local");
    const globalPath = join(tmpDir, "global", "config.json");
    const localPath = join(localDir, "config.json");

    mkdirSync(localDir, { recursive: true });
    mkdirSync(join(tmpDir, "global"), { recursive: true });

    // Local config has enabled = true
    writeFileSync(
      localPath,
      JSON.stringify({
        telemetry: { enabled: true, level: "standard", backend: "sqlite", retention: 30 },
      }),
      "utf-8"
    );

    // Global config has enabled = undefined
    writeFileSync(
      globalPath,
      JSON.stringify({
        telemetry: { level: "standard", backend: "sqlite", retention: 30 },
      }),
      "utf-8"
    );

    findLocalConfigDirSpy.mockReturnValue(localDir);
    resolveGlobalConfigPathSpy.mockReturnValue(globalPath);

    // Should use local config and return false
    expect(shouldPromptForTelemetry()).toBe(false);
  });

  it("returns false when config parse fails (prevents blocking execution)", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, "{ invalid json", "utf-8");

    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(configPath);

    expect(shouldPromptForTelemetry()).toBe(false);
  });
});

describe("promptForTelemetryOptIn", () => {
  let tmpDir: string;
  let findLocalConfigDirSpy: ReturnType<typeof vi.spyOn>;
  let resolveGlobalConfigPathSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `reygent-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    findLocalConfigDirSpy = vi.spyOn(config, "findLocalConfigDir");
    resolveGlobalConfigPathSpy = vi.spyOn(config, "resolveGlobalConfigPath");

    // Mock confirm to auto-approve
    const { confirm } = await import("@inquirer/prompts");
    vi.mocked(confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("saves enabled=true to local config when local config dir exists", async () => {
    const localDir = join(tmpDir, "local");
    mkdirSync(localDir, { recursive: true });

    findLocalConfigDirSpy.mockReturnValue(localDir);

    const { confirm } = await import("@inquirer/prompts");
    vi.mocked(confirm).mockResolvedValue(true);

    await promptForTelemetryOptIn();

    const configPath = join(localDir, "config.json");
    expect(existsSync(configPath)).toBe(true);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.telemetry.enabled).toBe(true);
    expect(written.telemetry.level).toBe("standard");
    expect(written.telemetry.backend).toBe("sqlite");
    expect(written.telemetry.retention).toBe(30);
  });

  it("saves enabled=false to global config when no local config dir exists", async () => {
    const globalPath = join(tmpDir, "global", "config.json");

    findLocalConfigDirSpy.mockReturnValue(null);
    resolveGlobalConfigPathSpy.mockReturnValue(globalPath);

    const { confirm } = await import("@inquirer/prompts");
    vi.mocked(confirm).mockResolvedValue(false);

    await promptForTelemetryOptIn();

    expect(existsSync(globalPath)).toBe(true);

    const written = JSON.parse(readFileSync(globalPath, "utf-8"));
    expect(written.telemetry.enabled).toBe(false);
  });

  it("preserves existing config fields when saving telemetry choice", async () => {
    const localDir = join(tmpDir, "local");
    const configPath = join(localDir, "config.json");
    mkdirSync(localDir, { recursive: true });

    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "claude",
        model: "claude-sonnet-4-5",
        agents: [],
      }),
      "utf-8"
    );

    findLocalConfigDirSpy.mockReturnValue(localDir);

    const { confirm } = await import("@inquirer/prompts");
    vi.mocked(confirm).mockResolvedValue(true);

    await promptForTelemetryOptIn();

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.provider).toBe("claude");
    expect(written.model).toBe("claude-sonnet-4-5");
    expect(written.agents).toEqual([]);
    expect(written.telemetry.enabled).toBe(true);
  });

  it("applies defaults when existing telemetry config is partial", async () => {
    const localDir = join(tmpDir, "local");
    const configPath = join(localDir, "config.json");
    mkdirSync(localDir, { recursive: true });

    writeFileSync(
      configPath,
      JSON.stringify({
        telemetry: {
          level: "verbose",
        },
      }),
      "utf-8"
    );

    findLocalConfigDirSpy.mockReturnValue(localDir);

    const { confirm } = await import("@inquirer/prompts");
    vi.mocked(confirm).mockResolvedValue(true);

    await promptForTelemetryOptIn();

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.telemetry.enabled).toBe(true);
    expect(written.telemetry.level).toBe("verbose"); // preserved
    expect(written.telemetry.backend).toBe("sqlite"); // default
    expect(written.telemetry.retention).toBe(30); // default
  });
});
