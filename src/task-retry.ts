const TRANSIENT_ERROR_RE = /Could not resolve host|Connection refused|Connection timed out|Connection reset|fatal: unable to access|fatal: Could not read from remote|SSL_ERROR|TLS handshake|rate limit|429|500 Internal Server Error|502 Bad Gateway|503 Service|504 Gateway|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|shallow file has changed/i;

export function isTransientTaskError(error: string): boolean {
  return TRANSIENT_ERROR_RE.test(error);
}

export function withCappedJitter(baseDelayMs: number, maxDelayMs: number, jitter = true): number {
  const base = Math.min(baseDelayMs, maxDelayMs);
  if (!jitter) return base;
  return Math.min(base + Math.random() * 0.25 * base, maxDelayMs);
}
