import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDir } from "./helpers.js";

// node:os mock must be registered before importing env.ts (which reads homedir()).
let fakeHome = "";
mock.module("node:os", () => ({ homedir: () => fakeHome }));

const { loadWorkDir, loadCleanConfig } = await import("../config.js");
const { normalizeCheckVerdict } = await import("../pr-status.js");
const { loadEnvFallback } = await import("../env.js");
const { checkForUpdate } = await import("../updater.js");

const RELEASES_URL = "https://api.github.com/repos/ack-ventures/critters/releases/latest";
const BIN_URL = "https://github.com/ack-ventures/critters/releases/download/v2.0.0/bin";
const CHECKSUM_URL = "https://github.com/ack-ventures/critters/releases/download/v2.0.0/checksums-sha256.txt";

const EXPECTED_ASSET = `critters-${process.platform}-${process.arch}`;

// ---------------------------------------------------------------------------
// B18 — empty / comment-only config must not throw a cryptic TypeError
// ---------------------------------------------------------------------------
describe("B18: empty/comment-only config (config.ts null guard)", () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const t = createTempDir();
    tempDir = t.path;
    cleanup = t.cleanup;
  });
  afterEach(() => cleanup());

  function writeConfig(contents: string): string {
    const p = join(tempDir, "critters.config.yaml");
    writeFileSync(p, contents);
    return p;
  }

  test("loadWorkDir returns the default for a comment-only file instead of throwing", () => {
    const p = writeConfig("# only a comment\n");
    expect(() => loadWorkDir(p)).not.toThrow();
    // /tmp may resolve to /private/tmp on macOS; the point is the default workDir.
    expect(loadWorkDir(p)).toMatch(/\/tmp\/critters-work$/);
  });

  test("loadWorkDir returns the default for an empty file", () => {
    const p = writeConfig("");
    expect(loadWorkDir(p)).toMatch(/\/tmp\/critters-work$/);
  });

  test("loadCleanConfig returns defaults for a comment-only file instead of throwing", () => {
    const p = writeConfig("# nothing here\n");
    expect(() => loadCleanConfig(p)).not.toThrow();
    const clean = loadCleanConfig(p);
    expect(clean.workDir).toMatch(/\/tmp\/critters-work$/);
    expect(clean.healthPort).toBe(3847);
    expect(clean.tmuxSession).toBe("critters");
  });
});

// ---------------------------------------------------------------------------
// B20 — legacy StatusContext nodes (state) must map to success/failure
// ---------------------------------------------------------------------------
describe("B20: normalizeCheckVerdict (pr-status.ts)", () => {
  test("StatusContext SUCCESS (state, no conclusion) → success, not pending", () => {
    expect(normalizeCheckVerdict({ state: "SUCCESS" })).toBe("success");
  });

  test("StatusContext FAILURE/ERROR (state) → failure", () => {
    expect(normalizeCheckVerdict({ state: "FAILURE" })).toBe("failure");
    expect(normalizeCheckVerdict({ state: "ERROR" })).toBe("failure");
  });

  test("StatusContext PENDING (state) → pending", () => {
    expect(normalizeCheckVerdict({ state: "PENDING" })).toBe("pending");
  });

  test("CheckRun conclusion takes precedence and maps correctly", () => {
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "SUCCESS" })).toBe("success");
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "FAILURE" })).toBe("failure");
  });

  test("CheckRun in progress (no conclusion, not COMPLETED) → pending", () => {
    expect(normalizeCheckVerdict({ status: "IN_PROGRESS" })).toBe("pending");
  });

  test("COMPLETED CheckRun with a non-failing conclusion → success, not pending", () => {
    // Regression: SKIPPED/NEUTRAL/STALE/CANCELLED used to read as perpetually pending.
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "SKIPPED" })).toBe("success");
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "NEUTRAL" })).toBe("success");
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "STALE" })).toBe("success");
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "CANCELLED" })).toBe("success");
  });

  test("CheckRun with a genuinely failing conclusion → failure", () => {
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "TIMED_OUT" })).toBe("failure");
    expect(normalizeCheckVerdict({ status: "COMPLETED", conclusion: "ACTION_REQUIRED" })).toBe("failure");
  });
});

// ---------------------------------------------------------------------------
// env.ts — quote stripping and `export ` prefix in the fallback .env loader
// ---------------------------------------------------------------------------
describe("env.ts: loadEnvFallback quote stripping", () => {
  let tempDir: string;
  let cleanup: () => void;
  let originalCwd: string;
  const touched: string[] = [];

  beforeEach(() => {
    const t = createTempDir();
    tempDir = t.path;
    cleanup = t.cleanup;
    fakeHome = join(tempDir, "home");
    mkdirSync(join(fakeHome, ".critters"), { recursive: true });
    const cwd = join(tempDir, "cwd");
    mkdirSync(cwd, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const k of touched) delete process.env[k];
    touched.length = 0;
    cleanup();
  });

  function writeEnv(contents: string): void {
    writeFileSync(join(fakeHome, ".critters", ".env"), contents);
  }

  test("strips surrounding double quotes", () => {
    writeEnv('QUOTED_DQ_TEST="lin_secret"\n');
    touched.push("QUOTED_DQ_TEST");
    loadEnvFallback();
    expect(process.env.QUOTED_DQ_TEST).toBe("lin_secret");
  });

  test("strips surrounding single quotes", () => {
    writeEnv("QUOTED_SQ_TEST='lin_secret'\n");
    touched.push("QUOTED_SQ_TEST");
    loadEnvFallback();
    expect(process.env.QUOTED_SQ_TEST).toBe("lin_secret");
  });

  test("handles a leading `export ` prefix", () => {
    writeEnv('export EXPORT_TEST="abc123"\n');
    touched.push("EXPORT_TEST");
    loadEnvFallback();
    expect(process.env.EXPORT_TEST).toBe("abc123");
  });

  test("leaves unquoted values untouched", () => {
    writeEnv("PLAIN_TEST=lin_plain\n");
    touched.push("PLAIN_TEST");
    loadEnvFallback();
    expect(process.env.PLAIN_TEST).toBe("lin_plain");
  });

  test("does not strip mismatched/inner quotes", () => {
    writeEnv("MISMATCH_TEST=\"unterminated\n");
    touched.push("MISMATCH_TEST");
    loadEnvFallback();
    expect(process.env.MISMATCH_TEST).toBe('"unterminated');
  });
});

// ---------------------------------------------------------------------------
// B13 / updater integrity — checkForUpdate returns false on bad downloads
// ---------------------------------------------------------------------------
describe("checkForUpdate integrity (updater.ts)", () => {
  let originalExecPath: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalExecPath = process.execPath;
    originalFetch = globalThis.fetch;
    // Pretend we are a compiled binary (basename !== bun) at a path that is never
    // actually written to in the failure paths under test.
    Object.defineProperty(process, "execPath", { value: "/tmp/critters-fake-binary", writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "execPath", { value: originalExecPath, writable: true });
    globalThis.fetch = originalFetch;
  });

  function mockFetch(opts: {
    includeChecksumAsset: boolean;
    binaryBody: string;
    contentLength: string;
    checksumText?: string;
  }): void {
    const assets: Array<{ name: string; browser_download_url: string }> = [
      { name: EXPECTED_ASSET, browser_download_url: BIN_URL },
    ];
    if (opts.includeChecksumAsset) {
      assets.push({ name: "checksums-sha256.txt", browser_download_url: CHECKSUM_URL });
    }
    const releaseData = { tag_name: "v2.0.0", assets };

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u === RELEASES_URL) {
        return new Response(JSON.stringify(releaseData), { status: 200 });
      }
      if (u === BIN_URL) {
        return new Response(opts.binaryBody, {
          status: 200,
          headers: { "Content-Length": opts.contentLength },
        });
      }
      if (u === CHECKSUM_URL) {
        return new Response(opts.checksumText ?? "", { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof globalThis.fetch;
  }

  test("returns false on a truncated download (buffer.length !== Content-Length)", async () => {
    const body = "x".repeat(100);
    // Use the VALID checksum of the received body so this test isolates the
    // truncation guard — the download fails the length check before checksum
    // verification, and a passing checksum proves nothing else rejected it.
    const validHash = createHash("sha256").update(body).digest("hex");
    mockFetch({
      includeChecksumAsset: true,
      binaryBody: body,
      contentLength: "200", // advertises more than we received
      checksumText: `${validHash}  ${EXPECTED_ASSET}\n`,
    });
    const result = await checkForUpdate("1.0.0");
    expect(result).toBe(false);
  });

  test("returns false on a SHA-256 checksum mismatch", async () => {
    const body = "x".repeat(100);
    mockFetch({
      includeChecksumAsset: true,
      binaryBody: body,
      contentLength: String(Buffer.byteLength(body)),
      checksumText: `deadbeefdeadbeef  ${EXPECTED_ASSET}\n`,
    });
    const result = await checkForUpdate("1.0.0");
    expect(result).toBe(false);
  });

  test("auto-update returns false when the checksum asset is missing", async () => {
    const body = "x".repeat(100);
    mockFetch({
      includeChecksumAsset: false,
      binaryBody: body,
      contentLength: String(Buffer.byteLength(body)),
    });
    // Auto-update path (requireChecksum) → missing checksum is a hard failure.
    const result = await checkForUpdate("1.0.0", { requireChecksum: true });
    expect(result).toBe(false);
  });

  test("returns false (no-op) when already up to date", async () => {
    mockFetch({
      includeChecksumAsset: true,
      binaryBody: "x",
      contentLength: "1",
    });
    const result = await checkForUpdate("9.9.9");
    expect(result).toBe(false);
  });
});
