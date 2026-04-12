import { readSpec, SpecError } from "../spec.js";
import { isJiraKey, readJiraSpec } from "../jira.js";
import { loadEnvFile } from "../env.js";

export async function specCommand(source: string): Promise<void> {
  try {
    if (isJiraKey(source)) {
      loadEnvFile();
      const payload = await readJiraSpec(source);
      console.log(JSON.stringify(payload, null, 2));
    } else {
      const payload = readSpec(source);
      console.log(JSON.stringify(payload, null, 2));
    }
  } catch (err) {
    if (err instanceof SpecError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
