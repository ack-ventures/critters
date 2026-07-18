import { timingSafeEqual } from "node:crypto";

export function checkAuth(req: Request, token: string | undefined): Response | null {
  if (token === undefined) return null;

  const header = req.headers.get("Authorization");
  if (header?.startsWith("Bearer ") && safeEqual(header.slice("Bearer ".length), token)) {
    return null;
  }

  const cookie = readCookie(req, "critters_token");
  if (cookie !== null && safeEqual(cookie, token)) return null;

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Constant-time string comparison. Guards on byte length first (timingSafeEqual
 * throws on length mismatch) so the dashboard token can't be probed via a timing
 * oracle when the daemon is exposed through a tunnel.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}
