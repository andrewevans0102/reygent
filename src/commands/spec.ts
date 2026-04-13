import { loadSpec, SpecError } from "../spec.js";

export async function specCommand(source: string): Promise<void> {
  try {
    const payload = await loadSpec(source);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    if (err instanceof SpecError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
