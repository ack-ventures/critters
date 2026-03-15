import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAllowedApiUrl, isAllowedDownloadUrl, parseChecksumFile, verifyChecksum } from "../updater.js";

// Capture log output
const logCalls: string[] = [];
const logErrorCalls: string[] = [];

mock.module("../logger.js", () => ({
  log: (...args: unknown[]) => logCalls.push(args.join(" ")),
  logError: (...args: unknown[]) => logErrorCalls.push(args.join(" ")),
}));

// Re-import after mocking
const { checkForUpdate, checkForUpdateAvailable, fetchLatestVersion, getDisplayVersion, _resetCachedLatestVersion } = await import("../updater.js");

let tempDir: string;
let fakeBinaryPath: string;
let originalExecPath: string;
const originalFetch = globalThis.fetch;

const ORIGINAL_CONTENT = "original-binary-content";
const UPDATED_CONTENT = "updated-binary-content";

function makeRelease(version: string) {
  return {
    tag_name: `v${version}`,
    assets: [
      {
        name: `critters-${process.platform}-${process.arch}`,
        browser_download_url: "https://objects.githubusercontent.com/download/critters",
      },
    ],
  };
}

function makeReleaseWithChecksum(version: string, checksumContent: string, checksumUrl?: string) {
  return {
    tag_name: `v${version}`,
    assets: [
      {
        name: `critters-${process.platform}-${process.arch}`,
        browser_download_url: "https://objects.githubusercontent.com/download/critters",
      },
      {
        name: "checksums-sha256.txt",
        browser_download_url: checksumUrl ?? "https://objects.githubusercontent.com/download/checksums-sha256.txt",
      },
    ],
    _checksumContent: checksumContent,
  };
}

function makeChecksumFile(content: string): string {
  const hash = createHash("sha256").update(content).digest("hex");
  const binaryName = `critters-${process.platform}-${process.arch}`;
  return `${hash}  ${binaryName}\n`;
}

function mockFetchSuccess(releaseVersion: string) {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("api.github.com")) {
      return Promise.resolve(new Response(JSON.stringify(makeRelease(releaseVersion)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    // Download URL
    return Promise.resolve(new Response(UPDATED_CONTENT, { status: 200 }));
  }) as unknown as typeof fetch;
}

function mockFetchDownloadFails(releaseVersion: string) {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("api.github.com")) {
      return Promise.resolve(new Response(JSON.stringify(makeRelease(releaseVersion)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    // Download fails
    return Promise.reject(new Error("Download failed"));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "updater-test-"));
  fakeBinaryPath = join(tempDir, "critters");
  writeFileSync(fakeBinaryPath, ORIGINAL_CONTENT);
  originalExecPath = process.execPath;
  Object.defineProperty(process, "execPath", {
    value: fakeBinaryPath,
    writable: true,
    configurable: true,
  });
  logCalls.length = 0;
  logErrorCalls.length = 0;
});

afterEach(() => {
  Object.defineProperty(process, "execPath", {
    value: originalExecPath,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = originalFetch;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("checkForUpdate backup", () => {
  test("creates backup before applying update", async () => {
    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf-8")).toBe(ORIGINAL_CONTENT);

    // The main binary should have the new content
    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(UPDATED_CONTENT);
  });

  test("overwrites existing backup from prior update", async () => {
    // Pre-existing backup with old content
    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    writeFileSync(backupPath, "old-backup-content");

    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    // Backup should now contain the current binary content, not old backup
    expect(readFileSync(backupPath, "utf-8")).toBe(ORIGINAL_CONTENT);
  });

  test("restores backup on update failure", async () => {
    // Pre-create a backup to simulate a prior successful update.
    // Then trigger a failure that lands in the catch block where restore runs.
    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    writeFileSync(backupPath, ORIGINAL_CONTENT);

    // Corrupt the binary to simulate a partial update gone wrong
    writeFileSync(fakeBinaryPath, "corrupted-content");

    // Mock fetch: version check succeeds but download rejects (throws into catch block).
    // The catch block will find the v1.0.0.bak and restore it.
    mockFetchDownloadFails("2.0.0");
    await checkForUpdate("1.0.0");

    // The restore logic should have copied the backup back over the binary
    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);
    expect(logErrorCalls.some((l) => l.includes("Restored previous binary"))).toBe(true);
  });

  test("skips restore when no backup exists", async () => {
    // Download fails — error occurs before backup step
    mockFetchDownloadFails("2.0.0");
    await checkForUpdate("1.0.0");

    // Original binary should be unchanged (download failed before any FS operations)
    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);

    // No backup should exist
    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    expect(existsSync(backupPath)).toBe(false);

    // Should have logged the error
    expect(logCalls.some((l) => l.includes("Update available"))).toBe(true);
    expect(logErrorCalls.some((l) => l.includes("Update failed"))).toBe(true);
  });

  test("logs backup path", async () => {
    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    const backupPath = join(tempDir, "critters-v1.0.0.bak");
    expect(logCalls.some((l) => l.includes(`Backup saved to ${backupPath}`))).toBe(true);
  });
});

describe("src/updater.ts", () => {
  describe("isAllowedDownloadUrl", () => {
    // Allowed domains
    test("allows github.com", () => {
      expect(isAllowedDownloadUrl("https://github.com/org/repo/releases/download/v1.0/binary")).toBe(true);
    });

    test("allows objects.githubusercontent.com", () => {
      expect(isAllowedDownloadUrl("https://objects.githubusercontent.com/some/path")).toBe(true);
    });

    test("allows subdomains of githubusercontent.com", () => {
      expect(isAllowedDownloadUrl("https://foo.githubusercontent.com/path")).toBe(true);
    });

    // Rejected domains
    test("rejects evil.com", () => {
      expect(isAllowedDownloadUrl("https://evil.com/binary")).toBe(false);
    });

    test("rejects attacker-githubusercontent.com (suffix match bypass attempt)", () => {
      expect(isAllowedDownloadUrl("https://attacker-githubusercontent.com/binary")).toBe(false);
    });

    test("rejects githubusercontent.com.evil.com", () => {
      expect(isAllowedDownloadUrl("https://githubusercontent.com.evil.com/binary")).toBe(false);
    });

    // Protocol checks
    test("rejects http (non-https)", () => {
      expect(isAllowedDownloadUrl("http://github.com/org/repo/releases/download/v1.0/binary")).toBe(false);
    });

    test("rejects ftp protocol", () => {
      expect(isAllowedDownloadUrl("ftp://github.com/file")).toBe(false);
    });

    // Edge cases
    test("rejects empty string", () => {
      expect(isAllowedDownloadUrl("")).toBe(false);
    });

    test("rejects invalid URL", () => {
      expect(isAllowedDownloadUrl("not-a-url")).toBe(false);
    });

    test("rejects bare githubusercontent.com (not a subdomain)", () => {
      expect(isAllowedDownloadUrl("https://githubusercontent.com/path")).toBe(false);
    });
  });

  describe("isAllowedApiUrl", () => {
    test("allows api.github.com", () => {
      expect(isAllowedApiUrl("https://api.github.com/repos/org/repo/releases/latest")).toBe(true);
    });

    test("rejects non-https", () => {
      expect(isAllowedApiUrl("http://api.github.com/repos/org/repo")).toBe(false);
    });

    test("rejects other domains", () => {
      expect(isAllowedApiUrl("https://evil.com/api")).toBe(false);
    });

    test("rejects api.github.com.evil.com", () => {
      expect(isAllowedApiUrl("https://api.github.com.evil.com/repos")).toBe(false);
    });

    test("rejects empty string", () => {
      expect(isAllowedApiUrl("")).toBe(false);
    });
  });

  describe("parseChecksumFile", () => {
    test("parses standard two-entry format", () => {
      const content =
        "abc123  critters-darwin-arm64\ndef456  critters-linux-x64\n";
      const result = parseChecksumFile(content);
      expect(result.size).toBe(2);
      expect(result.get("critters-darwin-arm64")).toBe("abc123");
      expect(result.get("critters-linux-x64")).toBe("def456");
    });

    test("handles single entry", () => {
      const result = parseChecksumFile("abc123  critters-darwin-arm64\n");
      expect(result.size).toBe(1);
      expect(result.get("critters-darwin-arm64")).toBe("abc123");
    });

    test("handles empty string", () => {
      const result = parseChecksumFile("");
      expect(result.size).toBe(0);
    });

    test("handles lines with extra whitespace", () => {
      const result = parseChecksumFile("  abc123   critters-darwin-arm64  \n");
      expect(result.get("critters-darwin-arm64")).toBe("abc123");
    });

    test("ignores blank lines", () => {
      const content = "abc123  file1\n\n\ndef456  file2\n";
      const result = parseChecksumFile(content);
      expect(result.size).toBe(2);
    });

    test("handles single-space separation", () => {
      const result = parseChecksumFile("abc123 critters-darwin-arm64\n");
      expect(result.get("critters-darwin-arm64")).toBe("abc123");
    });
  });

  describe("verifyChecksum", () => {
    test("returns true for matching hash", () => {
      const data = Buffer.from("hello world");
      // SHA-256 of "hello world"
      const expected =
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
      expect(verifyChecksum(data, expected)).toBe(true);
    });

    test("returns false for non-matching hash", () => {
      const data = Buffer.from("hello world");
      expect(verifyChecksum(data, "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
    });

    test("case-insensitive comparison", () => {
      const data = Buffer.from("hello world");
      const uppercase =
        "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9";
      expect(verifyChecksum(data, uppercase)).toBe(true);
    });

    test("known test vector: empty buffer", () => {
      const data = Buffer.from("");
      const expected =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      expect(verifyChecksum(data, expected)).toBe(true);
    });
  });
});

describe("checkForUpdate checksum verification", () => {
  test("valid checksum — update proceeds normally", async () => {
    const checksumContent = makeChecksumFile(UPDATED_CONTENT);
    const release = makeReleaseWithChecksum("2.0.0", checksumContent);

    globalThis.fetch = mock((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(new Response(JSON.stringify(release), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("checksums-sha256.txt")) {
        return Promise.resolve(new Response(release._checksumContent, { status: 200 }));
      }
      return Promise.resolve(new Response(UPDATED_CONTENT, { status: 200 }));
    }) as unknown as typeof fetch;

    await checkForUpdate("1.0.0");

    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(UPDATED_CONTENT);
    expect(logCalls.some((l) => l.includes("Checksum verified (SHA-256)"))).toBe(true);
    expect(logErrorCalls.length).toBe(0);
  });

  test("checksum mismatch — update aborts, binary unchanged", async () => {
    const binaryName = `critters-${process.platform}-${process.arch}`;
    const badChecksumContent = `badhash  ${binaryName}\n`;
    const release = makeReleaseWithChecksum("2.0.0", badChecksumContent);

    globalThis.fetch = mock((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(new Response(JSON.stringify(release), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("checksums-sha256.txt")) {
        return Promise.resolve(new Response(release._checksumContent, { status: 200 }));
      }
      return Promise.resolve(new Response(UPDATED_CONTENT, { status: 200 }));
    }) as unknown as typeof fetch;

    await checkForUpdate("1.0.0");

    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);
    expect(logErrorCalls.some((l) => l.includes("checksum mismatch"))).toBe(true);
  });

  test("checksum file download fails (HTTP error) — update aborts", async () => {
    const release = makeReleaseWithChecksum("2.0.0", "irrelevant");

    globalThis.fetch = mock((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(new Response(JSON.stringify(release), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("checksums-sha256.txt")) {
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      }
      return Promise.resolve(new Response(UPDATED_CONTENT, { status: 200 }));
    }) as unknown as typeof fetch;

    await checkForUpdate("1.0.0");

    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);
    expect(logErrorCalls.some((l) => l.includes("failed to download checksum file"))).toBe(true);
  });

  test("checksum file missing from release — warning logged, update proceeds", async () => {
    mockFetchSuccess("2.0.0");
    await checkForUpdate("1.0.0");

    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(UPDATED_CONTENT);
    expect(logCalls.some((l) => l.includes("checksums-sha256.txt not found in release, skipping verification"))).toBe(true);
  });

  test("checksum URL points to disallowed domain — update aborts", async () => {
    const release = makeReleaseWithChecksum("2.0.0", "irrelevant", "https://evil.com/checksums-sha256.txt");

    globalThis.fetch = mock((url: string) => {
      if (url.includes("api.github.com")) {
        return Promise.resolve(new Response(JSON.stringify(release), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(UPDATED_CONTENT, { status: 200 }));
    }) as unknown as typeof fetch;

    await checkForUpdate("1.0.0");

    expect(readFileSync(fakeBinaryPath, "utf-8")).toBe(ORIGINAL_CONTENT);
    expect(logErrorCalls.some((l) => l.includes("checksum URL points to unexpected domain"))).toBe(true);
  });
});

describe("fetchLatestVersion", () => {
  beforeEach(() => {
    _resetCachedLatestVersion();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetCachedLatestVersion();
  });

  test("returns version from GitHub release", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v1.2.3" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    const result = await fetchLatestVersion();
    expect(result).toBe("1.2.3");
  });

  test("strips v prefix from tag_name", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v0.4.4" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    const result = await fetchLatestVersion();
    expect(result).toBe("0.4.4");
  });

  test("caches result and only fetches once", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v1.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchLatestVersion();
    const second = await fetchLatestVersion();

    expect(first).toBe("1.0.0");
    expect(second).toBe("1.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns null on network error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as typeof fetch;

    const result = await fetchLatestVersion();
    expect(result).toBeNull();
  });

  test("returns null on non-200 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    ) as unknown as typeof fetch;

    const result = await fetchLatestVersion();
    expect(result).toBeNull();
  });

  test("returns null when tag_name is not a string", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    const result = await fetchLatestVersion();
    expect(result).toBeNull();
  });
});

describe("getDisplayVersion", () => {
  beforeEach(() => {
    _resetCachedLatestVersion();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetCachedLatestVersion();
  });

  test("returns 'vdev' when VERSION is dev and no cache", () => {
    // VERSION is "dev" in the test environment
    const result = getDisplayVersion();
    expect(result).toBe("vdev");
  });

  test("returns 'vdev (latest: v1.2.3)' when VERSION is dev and cache populated", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v1.2.3" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    await fetchLatestVersion();
    const result = getDisplayVersion();
    expect(result).toBe("vdev (latest: v1.2.3)");
  });
});

describe("checkForUpdateAvailable", () => {
  beforeEach(() => {
    _resetCachedLatestVersion();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(process, "execPath", { value: originalExecPath, writable: true });
    _resetCachedLatestVersion();
  });

  test("returns null when running via bun", async () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/bun", writable: true });
    const result = await checkForUpdateAvailable("1.0.0");
    expect(result).toBeNull();
  });

  test("returns null for dev version", async () => {
    const result = await checkForUpdateAvailable("dev");
    expect(result).toBeNull();
  });

  test("returns available=true when newer version exists", async () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v2.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    const result = await checkForUpdateAvailable("1.0.0");
    expect(result).not.toBeNull();
    expect(result!.available).toBe(true);
    expect(result!.latestVersion).toBe("2.0.0");
    expect(result!.currentVersion).toBe("1.0.0");
  });

  test("returns available=false when already up to date", async () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v1.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    const result = await checkForUpdateAvailable("1.0.0");
    expect(result).not.toBeNull();
    expect(result!.available).toBe(false);
  });

  test("returns null when fetch fails", async () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("error", { status: 500 })),
    ) as unknown as typeof fetch;

    const result = await checkForUpdateAvailable("1.0.0");
    expect(result).toBeNull();
  });

  test("strips pre-release suffix from latest version", async () => {
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/critters", writable: true });
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: "v2.0.0-rc1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;

    const result = await checkForUpdateAvailable("1.0.0");
    expect(result).not.toBeNull();
    expect(result!.latestVersion).toBe("2.0.0");
  });
});
