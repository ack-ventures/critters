import { describe, expect, test } from "bun:test";
import { buildPaneBanner } from "../cli/spawn.js";
import { isConnectionRefused } from "../cli-clean.js";
import { renderDashboard } from "../dashboard/main-page.js";
import type { HealthStatus } from "../health.js";

// B1 — Command injection via issue title in the generated tmux script.
describe("buildPaneBanner (B1: RCE via issue title)", () => {
  test("single-quotes the window name so a title can't execute shell", () => {
    const malicious = "ACK-1: $(touch /tmp/pwned) / plan";
    const line = buildPaneBanner("\x1b[1;36m", malicious, "\x1b[0m");
    // The untrusted name must sit inside a single-quoted segment spliced between the
    // double-quoted color parts: `"<color>━━━ "'<name>'" ━━━<reset>"`. Inside single
    // quotes bash performs no command/parameter expansion, so `$(…)` stays literal.
    expect(line).toContain(`"'${malicious}'"`);
    // And the substitution must NOT appear unquoted inside a double-quoted run.
    expect(line).not.toContain(`$(touch /tmp/pwned)" `);
  });

  test("escapes backticks the same way", () => {
    const line = buildPaneBanner("L", "ACK-2: `id` now", "R");
    expect(line).toContain("'ACK-2: `id` now'");
  });

  test("escapes embedded single quotes safely", () => {
    const line = buildPaneBanner("L", "it's mine", "R");
    // shellEscape turns ' into '\'' — still no way to break out of the quoting.
    expect(line).toContain("'it'\\''s mine'");
  });
});

// B3 — Reflected XSS via the window.__CRITTERS__ bootstrap.
describe("renderDashboard (B3: reflected XSS in bootstrap)", () => {
  const status = {} as HealthStatus;

  test("escapes script-breaking chars in the identifier", () => {
    const html = renderDashboard("", status, 0, undefined, undefined, "</script><img src=x onerror=alert(1)>");
    // The raw breakout must never reach the HTML verbatim...
    expect(html).not.toContain("</script><img");
    // ...it must be present only in \uXXXX-escaped form.
    expect(html).toContain("\\u003c/script\\u003e");
  });

  test("bootstrap stays valid JSON and round-trips to the original values", () => {
    const html = renderDashboard("", status, 0, "type</script>", undefined, "ID&<>");
    const m = html.match(/window\.__CRITTERS__ = (\{.*?\});/);
    expect(m).toBeTruthy();
    // JSON.parse natively decodes the \uXXXX escapes back to the real characters.
    const parsed = JSON.parse(m?.[1] ?? "{}") as { typeFilter: string; identifier: string };
    expect(parsed.identifier).toBe("ID&<>");
    expect(parsed.typeFilter).toBe("type</script>");
  });
});

// B4 — `clean` must fail closed when a daemon may be alive but health didn't answer.
describe("isConnectionRefused (B4: clean fail-open guard)", () => {
  test("treats genuine connection refusal as down (safe to clean)", () => {
    expect(isConnectionRefused({ code: "ConnectionRefused" })).toBe(true);
    expect(isConnectionRefused(new Error("connect ECONNREFUSED 127.0.0.1:7878"))).toBe(true);
    expect(isConnectionRefused(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(true);
  });

  test("treats timeouts/aborts as maybe-alive (unsafe — must NOT look like refusal)", () => {
    expect(isConnectionRefused(new DOMException("The operation timed out.", "TimeoutError"))).toBe(false);
    expect(isConnectionRefused(new Error("The operation was aborted"))).toBe(false);
  });

  test("unknown errors default to maybe-alive (fail closed)", () => {
    expect(isConnectionRefused(new Error("something weird happened"))).toBe(false);
    expect(isConnectionRefused(null)).toBe(false);
  });
});
