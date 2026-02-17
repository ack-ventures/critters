import { afterEach, describe, expect, mock, test } from "bun:test";
import { withRetry } from "../retry.js";

// Mock sleep to avoid real delays and capture delay values
const sleepCalls: number[] = [];
const originalSleep = await import("../utils.js").then((m) => m.sleep);

mock.module("../utils.js", () => ({
  ...require("../utils.js"),
  sleep: (ms: number) => {
    sleepCalls.push(ms);
    return Promise.resolve();
  },
}));

afterEach(() => {
  sleepCalls.length = 0;
});

describe("withRetry", () => {
  test("succeeds on first try", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("succeeds after retries", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("fail"));
      return Promise.resolve("recovered");
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("exhausts all retries and throws last error", async () => {
    const fn = mock(() => Promise.reject(new Error("always fails")));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 100, jitter: false }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  test("shouldRetry returning false causes immediate rethrow", async () => {
    const fn = mock(() => Promise.reject(new Error("non-retryable")));

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("shouldRetry returning true allows retries to proceed", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls < 2) return Promise.reject(new Error("retryable"));
      return Promise.resolve("ok");
    });

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      jitter: false,
      shouldRetry: (err) => (err as Error).message === "retryable",
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("onRetry callback receives correct arguments", async () => {
    let calls = 0;
    const fn = mock(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error(`fail-${calls}`));
      return Promise.resolve("ok");
    });

    const onRetryCalls: Array<{ error: unknown; attempt: number; delayMs: number }> = [];
    await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      jitter: false,
      onRetry: (error, attempt, delayMs) => {
        onRetryCalls.push({ error, attempt, delayMs });
      },
    });

    expect(onRetryCalls).toHaveLength(2);
    expect((onRetryCalls[0].error as Error).message).toBe("fail-1");
    expect(onRetryCalls[0].attempt).toBe(0);
    expect(onRetryCalls[0].delayMs).toBe(100); // 100 * 2^0
    expect((onRetryCalls[1].error as Error).message).toBe("fail-2");
    expect(onRetryCalls[1].attempt).toBe(1);
    expect(onRetryCalls[1].delayMs).toBe(200); // 100 * 2^1
  });

  test("exponential backoff delays", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));

    await withRetry(fn, {
      maxRetries: 4,
      baseDelayMs: 100,
      maxDelayMs: 30000,
      jitter: false,
    }).catch(() => {});

    expect(sleepCalls).toEqual([100, 200, 400, 800]); // 100*2^0, 100*2^1, 100*2^2, 100*2^3
  });

  test("maxDelayMs caps the delay", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));

    await withRetry(fn, {
      maxRetries: 4,
      baseDelayMs: 1000,
      maxDelayMs: 3000,
      jitter: false,
    }).catch(() => {});

    expect(sleepCalls).toEqual([1000, 2000, 3000, 3000]);
  });

  test("jitter adds 0-25% to delay", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));

    await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      jitter: true,
    }).catch(() => {});

    for (let i = 0; i < sleepCalls.length; i++) {
      const baseDelay = Math.min(1000 * 2 ** i, 30000);
      expect(sleepCalls[i]).toBeGreaterThanOrEqual(baseDelay);
      expect(sleepCalls[i]).toBeLessThanOrEqual(baseDelay * 1.25);
    }
  });

  test("jitter disabled gives exact delays", async () => {
    const fn = mock(() => Promise.reject(new Error("fail")));

    await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 500,
      jitter: false,
    }).catch(() => {});

    expect(sleepCalls).toEqual([500, 1000]);
  });

  test("return value is preserved", async () => {
    const obj = { foo: "bar", count: 42 };
    const result = await withRetry(() => Promise.resolve(obj), {
      maxRetries: 1,
      baseDelayMs: 100,
    });
    expect(result).toBe(obj);
  });
});
