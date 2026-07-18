const TRANSIENT_ERROR_RE = /Could not resolve host|Connection refused|Connection timed out|Connection reset|fatal: unable to access|fatal: Could not read from remote|SSL_ERROR|TLS handshake|rate limit|429|500 Internal Server Error|502 Bad Gateway|503 Service|504 Gateway|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|shallow file has changed/i;

export function isTransientTaskError(error: string): boolean {
  return TRANSIENT_ERROR_RE.test(error);
}

// Tracker fetch errors are the inverse problem from task errors: there is no
// reliable whitelist of transient message shapes (Bun/undici network failures
// and Linear SDK 5xx messages look nothing like git errors), so fail fast only
// on definitive client errors and retry everything else.
const PERMANENT_TRACKER_ERROR_RE = /\b(400|401|403|404|422)\b/;

export function isPermanentTrackerError(error: string): boolean {
  return PERMANENT_TRACKER_ERROR_RE.test(error);
}

export function withCappedJitter(baseDelayMs: number, maxDelayMs: number, jitter = true): number {
  const base = Math.min(baseDelayMs, maxDelayMs);
  if (!jitter) return base;
  return Math.min(base + Math.random() * 0.25 * base, maxDelayMs);
}
