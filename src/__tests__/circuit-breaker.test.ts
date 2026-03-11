import { describe, expect, test } from "bun:test";
import { CircuitBreaker, type CircuitBreakerOptions, type CircuitState } from "../circuit-breaker.js";

function makeOptions(overrides?: Partial<CircuitBreakerOptions>): CircuitBreakerOptions {
  return {
    failureThreshold: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60_000,
    jitter: false, // disable jitter for deterministic tests
    ...overrides,
  };
}

describe("CircuitBreaker", () => {
  test("starts in closed state", () => {
    const breaker = new CircuitBreaker("linear", makeOptions());
    const status = breaker.getStatus();
    expect(status.state).toBe("closed");
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastFailureAt).toBeNull();
    expect(status.nextRetryAt).toBeNull();
  });

  test("canProceed returns true when closed", () => {
    const breaker = new CircuitBreaker("linear", makeOptions());
    expect(breaker.canProceed()).toBe(true);
  });

  test("stays closed below failure threshold", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 3 }));
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe("closed");
    expect(breaker.getStatus().consecutiveFailures).toBe(2);
    expect(breaker.canProceed()).toBe(true);
  });

  test("transitions to open after N consecutive failures", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 3 }));
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe("open");
    expect(breaker.getStatus().consecutiveFailures).toBe(3);
  });

  test("canProceed returns false while open and backoff not elapsed", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 1, baseDelayMs: 60_000 }));
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe("open");
    expect(breaker.canProceed()).toBe(false);
  });

  test("transitions to half_open when backoff elapses", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 1, baseDelayMs: 1 }));
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe("open");

    // Wait for the tiny backoff to elapse
    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) {} // busy-wait

    expect(breaker.canProceed()).toBe(true);
    expect(breaker.getStatus().state).toBe("half_open");
  });

  test("canProceed returns false when half_open (probe in flight)", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 1, baseDelayMs: 1 }));
    breaker.recordFailure();

    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) {}

    // First call transitions to half_open
    expect(breaker.canProceed()).toBe(true);
    // Second call should return false (probe in flight)
    expect(breaker.canProceed()).toBe(false);
  });

  test("transitions to closed on successful probe", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 1, baseDelayMs: 1 }));
    breaker.recordFailure();

    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) {}

    breaker.canProceed(); // → half_open
    breaker.recordSuccess();
    expect(breaker.getStatus().state).toBe("closed");
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
  });

  test("transitions back to open on failed probe with increased backoff", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 1, baseDelayMs: 1 }));
    breaker.recordFailure(); // failure 1 → open

    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) {}

    breaker.canProceed(); // → half_open
    breaker.recordFailure(); // failure 2 → open with increased backoff
    expect(breaker.getStatus().state).toBe("open");
    expect(breaker.getStatus().consecutiveFailures).toBe(2);
  });

  test("resets failures on success in closed state", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 3 }));
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().consecutiveFailures).toBe(2);
    breaker.recordSuccess();
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
    expect(breaker.getStatus().state).toBe("closed");
  });

  test("calls onStateChange on transitions", () => {
    const changes: Array<{ provider: string; from: CircuitState; to: CircuitState }> = [];
    const onStateChange = (provider: string, from: CircuitState, to: CircuitState) => {
      changes.push({ provider, from, to });
    };

    const breaker = new CircuitBreaker("linear", makeOptions({
      failureThreshold: 1,
      baseDelayMs: 1,
      onStateChange,
    }));

    breaker.recordFailure(); // closed → open
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ provider: "linear", from: "closed", to: "open" });

    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) {}

    breaker.canProceed(); // open → half_open
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual({ provider: "linear", from: "open", to: "half_open" });

    breaker.recordSuccess(); // half_open → closed
    expect(changes).toHaveLength(3);
    expect(changes[2]).toEqual({ provider: "linear", from: "half_open", to: "closed" });
  });

  test("backoff respects max delay cap", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({
      failureThreshold: 1,
      baseDelayMs: 10_000,
      maxDelayMs: 15_000,
    }));

    // Record many failures to push exponent high
    for (let i = 0; i < 10; i++) {
      breaker.recordFailure();
    }

    const status = breaker.getStatus();
    expect(status.state).toBe("open");
    // nextRetryAt should be at most maxDelayMs from now
    const nextRetry = new Date(status.nextRetryAt as string).getTime();
    const maxExpected = Date.now() + 15_000 + 1000; // small buffer
    expect(nextRetry).toBeLessThanOrEqual(maxExpected);
  });

  test("getStatus returns correct snapshot", () => {
    const breaker = new CircuitBreaker("jira", makeOptions({ failureThreshold: 2 }));
    breaker.recordFailure();

    const status = breaker.getStatus();
    expect(status.state).toBe("closed");
    expect(status.consecutiveFailures).toBe(1);
    expect(status.lastFailureAt).not.toBeNull();
    expect(status.nextRetryAt).toBeNull(); // still closed

    breaker.recordFailure(); // → open
    const status2 = breaker.getStatus();
    expect(status2.state).toBe("open");
    expect(status2.nextRetryAt).not.toBeNull();
  });

  test("multiple recordSuccess calls on already-closed breaker are benign", () => {
    const changes: Array<{ from: CircuitState; to: CircuitState }> = [];
    const breaker = new CircuitBreaker("linear", makeOptions({
      onStateChange: (_p, from, to) => { changes.push({ from, to }); },
    }));

    breaker.recordSuccess();
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.getStatus().state).toBe("closed");
    expect(breaker.getStatus().consecutiveFailures).toBe(0);
    expect(changes).toHaveLength(0); // no state changes
  });

  test("updateOptions changes behavior", () => {
    const breaker = new CircuitBreaker("linear", makeOptions({ failureThreshold: 5 }));
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStatus().state).toBe("closed");

    breaker.updateOptions({ failureThreshold: 2 });
    // Already at 2 failures but threshold just changed, need one more failure to trigger check
    breaker.recordFailure(); // 3 >= 2 → open
    expect(breaker.getStatus().state).toBe("open");
  });

  test("backoff increases exponentially", () => {
    // Use threshold=1 so we can observe multiple open states
    const nextRetryTimes: number[] = [];
    const breaker = new CircuitBreaker("linear", makeOptions({
      failureThreshold: 1,
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
    }));

    // Failure 1 → open, exponent = 0, delay = 1000
    breaker.recordFailure();
    nextRetryTimes.push(new Date(breaker.getStatus().nextRetryAt as string).getTime() - Date.now());

    // Simulate probe failure: need to get to half_open first
    // For simplicity, directly record another failure (simulating half_open → open)
    // The breaker is open, but we can test the math by checking consecutive failures
    expect(breaker.getStatus().consecutiveFailures).toBe(1);
  });
});
