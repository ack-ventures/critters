import { log } from "./logger.js";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter?: boolean;
  onStateChange?: (provider: string, from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureAt = 0;
  private nextRetryAt = 0;
  private provider: string;
  private options: CircuitBreakerOptions;

  constructor(provider: string, options: CircuitBreakerOptions) {
    this.provider = provider;
    this.options = { jitter: true, ...options };
  }

  updateOptions(options: Partial<CircuitBreakerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  canProceed(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open" && Date.now() >= this.nextRetryAt) {
      this.transition("half_open");
      return true;
    }

    if (this.state === "half_open") return false;

    return false;
  }

  recordSuccess(): void {
    if (this.state === "half_open") {
      this.transition("closed");
    }
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();

    if (this.state === "closed" && this.consecutiveFailures >= this.options.failureThreshold) {
      this.computeNextRetry();
      this.transition("open");
    } else if (this.state === "half_open") {
      this.computeNextRetry();
      this.transition("open");
    }
  }

  getStatus(): {
    state: CircuitState;
    consecutiveFailures: number;
    lastFailureAt: string | null;
    nextRetryAt: string | null;
  } {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      nextRetryAt: this.state === "open" && this.nextRetryAt ? new Date(this.nextRetryAt).toISOString() : null,
    };
  }

  private computeNextRetry(): void {
    const exponent = Math.max(0, this.consecutiveFailures - this.options.failureThreshold);
    let delay = Math.min(
      this.options.baseDelayMs * 2 ** exponent,
      this.options.maxDelayMs,
    );
    if (this.options.jitter) {
      delay += Math.random() * 0.25 * delay;
    }
    this.nextRetryAt = Date.now() + delay;
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    log(`Circuit breaker [${this.provider}]: ${from} → ${to}`);
    this.options.onStateChange?.(this.provider, from, to);
  }
}
