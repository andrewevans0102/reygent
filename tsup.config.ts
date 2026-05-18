import { defineConfig } from "tsup";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node --no-warnings=ExperimentalWarning",
  },
  async onSuccess() {
    // Copy template.html to dist
    await copyFile(
      join(process.cwd(), "src/dashboard/template.html"),
      join(process.cwd(), "dist/template.html")
    );
    console.log("✓ Copied template.html");
  },
});
