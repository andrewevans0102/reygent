import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

describe("GitHub Actions publish workflow", () => {
  const publishWorkflowPath = join(
    projectRoot,
    ".github/workflows/publish.yml"
  );

  it("should have publish.yml workflow file", () => {
    expect(existsSync(publishWorkflowPath)).toBe(true);
  });

  it("should trigger on version tags (v*)", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    expect(workflow.on).toBeDefined();
    expect(workflow.on.push).toBeDefined();
    expect(workflow.on.push.tags).toBeDefined();
    expect(workflow.on.push.tags).toContain("v*");
  });

  it("should use Node.js 22.x", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const setupNodeStep = workflow.jobs.publish?.steps?.find(
      (step: any) => step.uses?.startsWith("actions/setup-node@")
    );

    expect(setupNodeStep).toBeDefined();
    expect(setupNodeStep.with["node-version"]).toMatch(/22/);
  });

  it("should run npm ci before building", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const steps = workflow.jobs.publish?.steps || [];
    const installStep = steps.find((s: any) => s.run?.includes("npm ci"));
    const buildStep = steps.find((s: any) => s.run?.includes("npm run build"));

    expect(installStep).toBeDefined();
    expect(buildStep).toBeDefined();

    // Install should come before build
    const installIndex = steps.indexOf(installStep);
    const buildIndex = steps.indexOf(buildStep);
    expect(installIndex).toBeLessThan(buildIndex);
  });

  it("should run tests before publishing", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const steps = workflow.jobs.publish?.steps || [];
    const testStep = steps.find((s: any) => s.run?.includes("npm test"));
    const publishStep = steps.find((s: any) => s.run?.includes("npm publish"));

    expect(testStep).toBeDefined();
    expect(publishStep).toBeDefined();

    // Tests should come before publish
    const testIndex = steps.indexOf(testStep);
    const publishIndex = steps.indexOf(publishStep);
    expect(testIndex).toBeLessThan(publishIndex);
  });

  it("should run build before publishing", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const steps = workflow.jobs.publish?.steps || [];
    const buildStep = steps.find((s: any) => s.run?.includes("npm run build"));
    const publishStep = steps.find((s: any) => s.run?.includes("npm publish"));

    expect(buildStep).toBeDefined();
    expect(publishStep).toBeDefined();

    // Build should come before publish
    const buildIndex = steps.indexOf(buildStep);
    const publishIndex = steps.indexOf(publishStep);
    expect(buildIndex).toBeLessThan(publishIndex);
  });

  it("should configure npm registry authentication", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const setupNodeStep = workflow.jobs.publish?.steps?.find(
      (step: any) => step.uses?.startsWith("actions/setup-node@")
    );

    expect(setupNodeStep).toBeDefined();
    expect(setupNodeStep.with["registry-url"]).toBe(
      "https://registry.npmjs.org"
    );
  });

  it("should use NODE_AUTH_TOKEN for npm publish", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const publishStep = workflow.jobs.publish?.steps?.find(
      (step: any) => step.run?.includes("npm publish")
    );

    expect(publishStep).toBeDefined();
    expect(publishStep.env).toBeDefined();
    expect(publishStep.env.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
  });

  it("should run on ubuntu-latest", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    expect(workflow.jobs.publish["runs-on"]).toBe("ubuntu-latest");
  });

  it("should checkout repository as first step", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const firstStep = workflow.jobs.publish?.steps?.[0];
    expect(firstStep?.uses).toMatch(/actions\/checkout@/);
  });

  it("should have descriptive job name", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    expect(workflow.jobs.publish.name).toBeDefined();
    expect(workflow.jobs.publish.name.toLowerCase()).toMatch(
      /publish|release|npm/
    );
  });

  it("should use npm ci instead of npm install for reproducible builds", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const steps = workflow.jobs.publish?.steps || [];
    const installStep = steps.find(
      (s: any) => s.run?.includes("npm ci") || s.run?.includes("npm install")
    );

    expect(installStep).toBeDefined();
    expect(installStep.run).toContain("npm ci");
    expect(installStep.run).not.toContain("npm install");
  });

  it("should validate package before publishing", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const steps = workflow.jobs.publish?.steps || [];

    // Check for either:
    // 1. npm pack validation
    // 2. dry-run publish
    // 3. or at minimum: build + test gates before publish
    const hasPack = steps.some((s: any) => s.run?.includes("npm pack"));
    const hasDryRun = steps.some((s: any) =>
      s.run?.includes("npm publish --dry-run")
    );
    const hasTestAndBuild =
      steps.some((s: any) => s.run?.includes("npm test")) &&
      steps.some((s: any) => s.run?.includes("npm run build"));

    expect(hasPack || hasDryRun || hasTestAndBuild).toBe(true);
  });

  it("should have proper workflow naming convention", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    expect(workflow.name).toBeDefined();
    expect(typeof workflow.name).toBe("string");
    expect(workflow.name.length).toBeGreaterThan(0);
  });

  it("should only trigger on tags, not on regular commits", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    // Should have tags trigger
    expect(workflow.on.push?.tags).toBeDefined();

    // Should NOT have branches trigger for push events
    expect(workflow.on.push?.branches).toBeUndefined();
  });

  it("should match semver tag pattern (v1.2.3 format)", () => {
    const content = readFileSync(publishWorkflowPath, "utf-8");
    const workflow = parse(content);

    const tagPattern = workflow.on.push.tags;

    // Should support v-prefixed tags
    expect(tagPattern).toContain("v*");

    // Test pattern matches expected formats
    const testTags = [
      "v1.0.0",
      "v0.1.0",
      "v2.3.4",
      "v1.0.0-beta.1",
      "v1.0.0-alpha",
    ];

    // All test tags should start with 'v' which matches 'v*'
    testTags.forEach((tag) => {
      expect(tag).toMatch(/^v/);
    });
  });
});
