import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  MAX_DIFF_TOKENS,
  splitDiffByFile,
  mergePRReviews,
  formatFileList,
  estimateCostMultiplier,
} from "./diff-split.js";
import type { PRReviewOutput } from "./task.js";

describe("diff-split", () => {
  describe("estimateTokens", () => {
    it("estimates tokens correctly", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("test")).toBe(1); // 4 chars = 1 token
      expect(estimateTokens("test test")).toBe(3); // 9 chars = 2.25, rounded up to 3
      expect(estimateTokens("a".repeat(100))).toBe(25); // 100 chars = 25 tokens
    });
  });

  describe("splitDiffByFile", () => {
    it("splits simple diff by file", () => {
      const diff = `diff --git a/file1.ts b/file1.ts
index abc123..def456 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
-old line
+new line
diff --git a/file2.ts b/file2.ts
index 789abc..012def 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,3 @@
-old line 2
+new line 2`;

      const files = splitDiffByFile(diff);
      expect(files).toHaveLength(2);
      expect(files[0].file).toBe("file1.ts");
      expect(files[0].diff).toContain("old line");
      expect(files[1].file).toBe("file2.ts");
      expect(files[1].diff).toContain("old line 2");
    });

    it("handles file with path containing spaces", () => {
      const diff = `diff --git a/path with spaces/file.ts b/path with spaces/file.ts
index abc123..def456 100644
--- a/path with spaces/file.ts
+++ b/path with spaces/file.ts
@@ -1,3 +1,3 @@
-old
+new`;

      const files = splitDiffByFile(diff);
      expect(files).toHaveLength(1);
      expect(files[0].file).toBe("path with spaces/file.ts");
    });

    it("handles empty diff", () => {
      const files = splitDiffByFile("");
      expect(files).toHaveLength(0);
    });
  });

  describe("mergePRReviews", () => {
    it("merges multiple reviews", () => {
      const reviews: PRReviewOutput[] = [
        {
          summary: "File 1 looks good",
          comments: [{ file: "file1.ts", line: 10, comment: "Fix this" }],
          recommendedActions: ["Action 1"],
        },
        {
          summary: "File 2 has issues",
          comments: [{ file: "file2.ts", line: 20, comment: "Fix that" }],
          recommendedActions: ["Action 2", "Action 1"],
        },
      ];

      const merged = mergePRReviews(reviews);
      expect(merged.summary).toContain("File set 1");
      expect(merged.summary).toContain("File set 2");
      expect(merged.comments).toHaveLength(2);
      expect(merged.recommendedActions).toContain("Action 1");
      expect(merged.recommendedActions).toContain("Action 2");
    });

    it("handles single review", () => {
      const reviews: PRReviewOutput[] = [
        {
          summary: "Looks good",
          comments: [],
          recommendedActions: [],
        },
      ];

      const merged = mergePRReviews(reviews);
      expect(merged.summary).toBe("Looks good");
    });

    it("handles empty array", () => {
      const merged = mergePRReviews([]);
      expect(merged.summary).toBe("No reviews to merge");
      expect(merged.comments).toHaveLength(0);
      expect(merged.recommendedActions).toHaveLength(0);
    });

    it("deduplicates recommended actions", () => {
      const reviews: PRReviewOutput[] = [
        { summary: "A", comments: [], recommendedActions: ["Action 1", "Action 2"] },
        { summary: "B", comments: [], recommendedActions: ["Action 2", "Action 3"] },
      ];

      const merged = mergePRReviews(reviews);
      expect(merged.recommendedActions).toHaveLength(3);
      expect(merged.recommendedActions).toEqual(
        expect.arrayContaining(["Action 1", "Action 2", "Action 3"])
      );
    });
  });

  describe("formatFileList", () => {
    it("formats short list", () => {
      const files = ["file1.ts", "file2.ts", "file3.ts"];
      const formatted = formatFileList(files);
      expect(formatted).toContain("file1.ts");
      expect(formatted).toContain("file2.ts");
      expect(formatted).toContain("file3.ts");
      expect(formatted).not.toContain("more files");
    });

    it("truncates long list", () => {
      const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
      const formatted = formatFileList(files, 10);
      expect(formatted).toContain("file0.ts");
      expect(formatted).toContain("file9.ts");
      expect(formatted).not.toContain("file10.ts");
      expect(formatted).toContain("10 more files");
    });
  });

  describe("estimateCostMultiplier", () => {
    it("calculates cost multiplier", () => {
      expect(estimateCostMultiplier(1)).toBe(1.0);
      expect(estimateCostMultiplier(2)).toBe(1.0);
      expect(estimateCostMultiplier(5)).toBe(2.5);
      expect(estimateCostMultiplier(10)).toBe(5.0);
    });
  });

  describe("MAX_DIFF_TOKENS", () => {
    it("is a reasonable threshold", () => {
      expect(MAX_DIFF_TOKENS).toBeGreaterThan(0);
      expect(MAX_DIFF_TOKENS).toBeLessThan(200_000); // Less than Claude context
    });
  });
});
