import { readSpec, SpecError } from "../spec.js";

export function specCommand(filePath: string): void {
  try {
    const payload = readSpec(filePath);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    if (err instanceof SpecError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
