import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { checkAuth } from "../auth.js";
import { escapeSlackText, formatFailure, formatTaskPickedUp } from "../slack.js";
import { verifyHmacSignature, verifyJiraSignature, verifyLinearSignature } from "../webhook.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ── B19: HMAC verification never throws on malformed headers ──────────────────

describe("verifyHmacSignature (B19)", () => {
  const secret = "test-secret";
  const body = '{"type":"Issue","action":"create"}';

  test("returns true for a valid signature", () => {
    expect(verifyHmacSignature(body, sign(body, secret), secret)).toBe(true);
  });

  test("returns false (does not throw) for a multi-byte header", () => {
    // A multi-byte character makes JS string .length differ from byte length,
    // which is exactly the case that made the old code throw a RangeError.
    const multiByte = "café-signature-🔥-with-emoji";
    expect(() => verifyHmacSignature(body, multiByte, secret)).not.toThrow();
    expect(verifyHmacSignature(body, multiByte, secret)).toBe(false);
  });

  test("returns false (does not throw) for an odd-length hex header", () => {
    expect(() => verifyHmacSignature(body, "abc", secret)).not.toThrow();
    expect(verifyHmacSignature(body, "abc", secret)).toBe(false);
  });

  test("returns false for a wrong but valid-length hex signature", () => {
    const wrong = "0".repeat(64);
    expect(verifyHmacSignature(body, wrong, secret)).toBe(false);
  });

  test("verifyLinearSignature accepts a valid signature", () => {
    expect(verifyLinearSignature(body, sign(body, secret), secret)).toBe(true);
  });

  test("verifyLinearSignature does not throw on a multi-byte header", () => {
    expect(() => verifyLinearSignature(body, "Ω".repeat(10), secret)).not.toThrow();
    expect(verifyLinearSignature(body, "Ω".repeat(10), secret)).toBe(false);
  });

  test("verifyJiraSignature strips the sha256= prefix and accepts a valid signature", () => {
    expect(verifyJiraSignature(body, `sha256=${sign(body, secret)}`, secret)).toBe(true);
  });

  test("verifyJiraSignature does not throw on a multi-byte header", () => {
    expect(() => verifyJiraSignature(body, "sha256=日本語", secret)).not.toThrow();
    expect(verifyJiraSignature(body, "sha256=日本語", secret)).toBe(false);
  });
});

// ── B21: Slack mrkdwn escaping neutralizes injection ──────────────────────────

describe("escapeSlackText (B21)", () => {
  test("neutralizes <!channel> broadcast injection", () => {
    const out = escapeSlackText("<!channel>");
    expect(out).toBe("&lt;!channel&gt;");
    expect(out).not.toContain("<!channel>");
  });

  test("neutralizes <@U123> mention and <url|text> link injection", () => {
    expect(escapeSlackText("<@U123>")).toBe("&lt;@U123&gt;");
    expect(escapeSlackText("<http://evil|click>")).toBe("&lt;http://evil|click&gt;");
  });

  test("escapes & before < and > (order matters)", () => {
    expect(escapeSlackText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  test("format helpers escape untrusted fields", () => {
    const msg = formatFailure("ACK-1", "<!channel> please fix", "error <@U999>");
    expect(msg).not.toContain("<!channel>");
    expect(msg).not.toContain("<@U999>");
    expect(msg).toContain("&lt;!channel&gt;");
    expect(msg).toContain("&lt;@U999&gt;");
  });

  test("format helpers escape a malicious repo URL", () => {
    const msg = formatTaskPickedUp("ACK-1", "Title", "<https://evil|pwn>");
    expect(msg).not.toContain("<https://evil|pwn>");
    expect(msg).toContain("&lt;https://evil|pwn&gt;");
  });
});

// ── Timing-safe dashboard token comparison ────────────────────────────────────

describe("checkAuth timing-safe comparison", () => {
  const token = "my-secret-token";

  test("accepts the correct Bearer token", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(checkAuth(req, token)).toBeNull();
  });

  test("accepts the correct cookie token", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Cookie: `critters_token=${token}` },
    });
    expect(checkAuth(req, token)).toBeNull();
  });

  test("rejects a wrong token of equal length", () => {
    const wrong = "x".repeat(token.length);
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Authorization: `Bearer ${wrong}` },
    });
    expect(checkAuth(req, token)?.status).toBe(401);
  });

  test("rejects a token of a different length without throwing", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Authorization: "Bearer short" },
    });
    expect(() => checkAuth(req, token)).not.toThrow();
    expect(checkAuth(req, token)?.status).toBe(401);
  });

  test("rejects a decoded multi-byte cookie token without throwing", () => {
    // Cookie values are percent-decoded, so this yields an actual multi-byte
    // string whose byte length differs from the configured token's — the case
    // that would make a naive timingSafeEqual throw.
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Cookie: "critters_token=%E6%97%A5%E6%9C%AC%E8%AA%9E" },
    });
    expect(() => checkAuth(req, token)).not.toThrow();
    expect(checkAuth(req, token)?.status).toBe(401);
  });
});
