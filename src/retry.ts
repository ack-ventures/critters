import { log } from "./logger.js";
import { withCappedJitter } from "./task-retry.js";
import { sleep } from "./utils.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs = 30_000,
    jitter = true,
    shouldRetry,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) break;
      if (shouldRetry && !shouldRetry(error)) throw error;

      const delay = withCappedJitter(baseDelayMs * 2 ** attempt, maxDelayMs, jitter);

      onRetry?.(error, attempt, delay);
      log(`Retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}
