import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  splitDiffByFile,
  selectDiffsWithinBudget,
  MAX_REVIEW_TOKENS,
} from "./diff-split.js";

describe("estimateTokens", () => {
  it("returns ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up", () => {
    expect(estimateTokens("ab")).toBe(1); // 2/4 = 0.5 → ceil = 1
    expect(estimateTokens("abcde")).toBe(2); // 5/4 = 1.25 → ceil = 2
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("MAX_REVIEW_TOKENS", () => {
  it("is 80000", () => {
    expect(MAX_REVIEW_TOKENS).toBe(80_000);
  });
});

describe("splitDiffByFile", () => {
  it("parses multi-file diff", () => {
    const raw = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
+import bar from "bar";
 const x = 1;
diff --git a/src/bar.ts b/src/bar.ts
index 111..222 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -10,2 +10,3 @@
+export const y = 2;
 export default {};`;

    const files = splitDiffByFile(raw);
    expect(files).toHaveLength(2);
    expect(files[0].file).toBe("src/foo.ts");
    expect(files[1].file).toBe("src/bar.ts");
    expect(files[0].diff).toContain('import bar from "bar"');
    expect(files[1].diff).toContain("export const y = 2");
    expect(files[0].tokens).toBeGreaterThan(0);
    expect(files[1].tokens).toBeGreaterThan(0);
  });

  it("parses single-file diff", () => {
    const raw = `diff --git a/README.md b/README.md
index abc..def 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
+Hello
 World`;

    const files = splitDiffByFile(raw);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe("README.md");
  });

  it("returns empty array for empty diff", () => {
    expect(splitDiffByFile("")).toEqual([]);
    expect(splitDiffByFile("  \n  ")).toEqual([]);
  });

  it("handles renamed files", () => {
    const raw = `diff --git a/old-name.ts b/new-name.ts
similarity index 95%
rename from old-name.ts
rename to new-name.ts
--- a/old-name.ts
+++ b/new-name.ts
@@ -1 +1 @@
-old
+new`;

    const files = splitDiffByFile(raw);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe("new-name.ts");
  });
});

describe("selectDiffsWithinBudget", () => {
  const makeFile = (name: string, size: number) => ({
    file: name,
    diff: "x".repeat(size * 4), // size tokens * 4 chars/token
    tokens: size,
  });

  it("includes all files when they fit", () => {
    const files = [makeFile("a.ts", 100), makeFile("b.ts", 200)];
    const { included, excluded } = selectDiffsWithinBudget(files, 1000, 100);
    expect(included).toHaveLength(2);
    expect(excluded).toHaveLength(0);
  });

  it("excludes files that exceed budget", () => {
    const files = [
      makeFile("a.ts", 100),
      makeFile("b.ts", 500),
      makeFile("c.ts", 100),
    ];
    // budget=400, reserved=100 → available=300
    const { included, excluded } = selectDiffsWithinBudget(files, 400, 100);
    expect(included).toHaveLength(2);
    expect(included[0].file).toBe("a.ts");
    expect(included[1].file).toBe("c.ts");
    expect(excluded).toEqual(["b.ts"]);
  });

  it("returns all excluded when nothing fits", () => {
    const files = [makeFile("a.ts", 500)];
    const { included, excluded } = selectDiffsWithinBudget(files, 100, 50);
    expect(included).toHaveLength(0);
    expect(excluded).toEqual(["a.ts"]);
  });

  it("handles empty file list", () => {
    const { included, excluded } = selectDiffsWithinBudget([], 1000, 0);
    expect(included).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });

  it("respects reserved tokens", () => {
    const files = [makeFile("a.ts", 100)];
    // budget=150, reserved=100 → available=50, file needs 100 → excluded
    const { included, excluded } = selectDiffsWithinBudget(files, 150, 100);
    expect(included).toHaveLength(0);
    expect(excluded).toEqual(["a.ts"]);
  });
});
