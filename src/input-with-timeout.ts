/**
 * Wrapper for @inquirer/prompts input() with timeout support
 */
import { input } from '@inquirer/prompts';

const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

export class InputTimeoutError extends Error {
  constructor(message: string = 'Input prompt timed out') {
    super(message);
    this.name = 'InputTimeoutError';
  }
}

/**
 * Prompts for input with optional timeout.
 * Throws InputTimeoutError if timeout exceeded.
 */
export async function inputWithTimeout(
  config: Parameters<typeof input>[0],
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new InputTimeoutError(`Input prompt timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    input(config)
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
