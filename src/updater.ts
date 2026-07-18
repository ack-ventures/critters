import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatError, log, logError } from "./logger.js";
import { VERSION } from "./version.js";

// Canonical release source — update this if the repo ever moves.
const RELEASES_URL = "https://api.github.com/repos/ack-ventures/critters/releases/latest";

let cachedLatestVersion: string | null = null;

export async function fetchLatestVersion(): Promise<string | null> {
  if (cachedLatestVersion !== null) return cachedLatestVersion;

  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "critters-updater",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const { tag_name } = data as { tag_name: unknown };

    if (typeof tag_name !== "string") return null;

    cachedLatestVersion = tag_name.replace(/^v/, "");
    return cachedLatestVersion;
  } catch {
    return null;
  }
}

export function getDisplayVersion(): string {
  if (VERSION !== "dev") return `v${VERSION}`;
  if (cachedLatestVersion !== null) return `vdev (latest: v${cachedLatestVersion})`;
  return "vdev";
}

// Exported for testing only
export function _resetCachedLatestVersion(): void {
  cachedLatestVersion = null;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdateAvailable(currentVersion: string): Promise<{
  available: boolean;
  currentVersion: string;
  latestVersion: string;
} | null> {
  const execName = process.execPath.split("/").pop() ?? "";
  if (execName === "bun" || execName === "bun.exe") return null;
  if (currentVersion === "dev") return null;

  _resetCachedLatestVersion();

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return null;

  const cleanLatest = latestVersion.replace(/-.*$/, "");
  return {
    available: compareSemver(cleanLatest, currentVersion) > 0,
    currentVersion,
    latestVersion: cleanLatest,
  };
}

export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    return (
      host === "github.com" ||
      host === "objects.githubusercontent.com" ||
      host.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}

export function isAllowedApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "api.github.com";
  } catch {
    return false;
  }
}

export function parseChecksumFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const hash = parts[0];
      const filename = parts[1];
      result.set(filename, hash);
    }
  }
  return result;
}

export function verifyChecksum(buffer: Buffer, expectedHash: string): boolean {
  const actual = createHash("sha256").update(buffer).digest("hex");
  return actual.toLowerCase() === expectedHash.toLowerCase();
}

async function downloadWithProgress(
  response: Response,
  showProgress: boolean,
): Promise<Buffer> {
  const contentLength = response.headers.get("Content-Length");
  const totalBytes =
    contentLength !== null ? Number.parseInt(contentLength, 10) : null;

  if (!showProgress || !response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedBytes += value.length;

    const receivedMB = (receivedBytes / 1_048_576).toFixed(1);

    if (totalBytes !== null && !Number.isNaN(totalBytes) && totalBytes > 0) {
      const pct = Math.min(
        100,
        Math.floor((receivedBytes / totalBytes) * 100),
      );
      const totalMB = (totalBytes / 1_048_576).toFixed(1);
      const filled = Math.round((pct / 100) * 20);
      const bar = "█".repeat(filled) + "░".repeat(20 - filled);
      process.stdout.write(
        `\rDownloading... [${bar}] ${pct}% ${receivedMB}MB/${totalMB}MB`,
      );
    } else {
      process.stdout.write(`\rDownloading... ${receivedMB}MB`);
    }
  }

  // Clear the progress line
  process.stdout.write(`\r${" ".repeat(60)}\r`);

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(result);
}

/**
 * Download and apply the latest release over the running binary.
 * Returns true ONLY when the renameSync over process.execPath actually
 * succeeded (i.e. a new binary is now in place). Every failure or no-op
 * (already up to date, download/verify error, etc.) returns false so callers
 * like the auto-updater don't restart onto an unchanged version.
 */
export async function checkForUpdate(
  currentVersion: string,
  opts?: { force?: boolean; requireChecksum?: boolean },
): Promise<boolean> {
  const force = opts?.force ?? false;
  // Auto-update opts in to strict verification: a missing checksum asset becomes
  // a hard failure so we never rename in a binary we couldn't verify.
  const requireChecksum = opts?.requireChecksum ?? false;
  const print = force ? console.log.bind(console) : log;
  const printError = force ? console.error.bind(console) : logError;

  // Only auto-update when running as a compiled binary — when running via
  // `bun run src/index.ts`, process.execPath points to the bun runtime itself.
  // We check the basename (not the full path) because the compiled binary may
  // live in a directory whose name contains "bun" (e.g. ~/.bun/bin/critters).
  const execName = process.execPath.split("/").pop() ?? "";
  if (execName === "bun" || execName === "bun.exe") {
    if (force) printError("Cannot update: running via bun, not as a compiled binary. Use install.sh to install.");
    return false;
  }

  if (currentVersion === "dev") {
    if (force) printError("Cannot check for updates: running a dev build.");
    return false;
  }

  if (!isAllowedApiUrl(RELEASES_URL)) {
    printError(`Update aborted: releases URL points to unexpected domain`);
    return false;
  }

  const tempPath = `${process.execPath}.update`;

  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "critters-updater",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      printError(`Update check failed: GitHub API returned ${response.status}`);
      return false;
    }

    const data = await response.json();
    const { tag_name, assets } = data as { tag_name: unknown; assets: unknown };

    if (typeof tag_name !== "string" || !Array.isArray(assets)) {
      printError("Update check failed: unexpected API response format");
      return false;
    }

    const latestVersion = tag_name.replace(/^v/, "").replace(/-.*$/, "");

    if (compareSemver(latestVersion, currentVersion) <= 0) {
      if (force) print(`Already up to date (v${currentVersion})`);
      return false;
    }

    print(`Update available: v${currentVersion} → v${latestVersion}`);

    const expectedName = `critters-${process.platform}-${process.arch}`;
    const asset = assets.find(
      (a: { name?: string }) => a.name === expectedName,
    ) as { name: string; browser_download_url?: string } | undefined;

    if (!asset || typeof asset.browser_download_url !== "string") {
      printError(`Update: no valid binary asset found for ${process.platform}-${process.arch}`);
      return false;
    }

    if (!isAllowedDownloadUrl(asset.browser_download_url)) {
      let hostname = "unknown";
      try { hostname = new URL(asset.browser_download_url).hostname; } catch {}
      printError(`Update aborted: download URL points to unexpected domain: ${hostname}`);
      return false;
    }

    const downloadResponse = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(120_000),
    });

    if (!downloadResponse.ok) {
      printError(`Update download failed: HTTP ${downloadResponse.status}`);
      return false;
    }

    const buffer = await downloadWithProgress(downloadResponse, force);

    // Reject a truncated download: if the server advertised a Content-Length and
    // the received bytes don't match, the binary is incomplete — never install it.
    const contentLengthHeader = downloadResponse.headers.get("Content-Length");
    const expectedBytes = contentLengthHeader !== null ? Number.parseInt(contentLengthHeader, 10) : null;
    if (expectedBytes !== null && !Number.isNaN(expectedBytes) && buffer.length !== expectedBytes) {
      printError(`Update aborted: download truncated (${buffer.length} of ${expectedBytes} bytes)`);
      return false;
    }

    // Checksum verification
    const checksumAsset = assets.find(
      (a: { name?: string }) => a.name === "checksums-sha256.txt",
    ) as { name: string; browser_download_url?: string } | undefined;

    if (checksumAsset && typeof checksumAsset.browser_download_url === "string") {
      if (!isAllowedDownloadUrl(checksumAsset.browser_download_url)) {
        let hostname = "unknown";
        try { hostname = new URL(checksumAsset.browser_download_url).hostname; } catch {}
        printError(`Update aborted: checksum URL points to unexpected domain: ${hostname}`);
        return false;
      }

      const checksumResponse = await fetch(checksumAsset.browser_download_url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!checksumResponse.ok) {
        printError(`Update: failed to download checksum file (HTTP ${checksumResponse.status}), aborting update`);
        return false;
      }

      const checksumContent = await checksumResponse.text();
      const checksums = parseChecksumFile(checksumContent);
      const expectedHash = checksums.get(expectedName);

      if (!expectedHash) {
        printError(`Update: checksum for ${expectedName} not found in checksums-sha256.txt, aborting update`);
        return false;
      }

      if (!verifyChecksum(buffer, expectedHash)) {
        printError("Update: SHA-256 checksum mismatch, aborting update (possible tampering or corruption)");
        return false;
      }

      print("Checksum verified (SHA-256)");
    } else if (requireChecksum) {
      // Auto-update must never rename in a binary it could not verify.
      printError("Update aborted: checksums-sha256.txt not found in release, cannot verify binary for auto-update");
      return false;
    } else {
      print("Update: checksums-sha256.txt not found in release, skipping verification");
    }

    writeFileSync(tempPath, buffer);
    chmodSync(tempPath, 0o755);
    const backupPath = `${dirname(process.execPath)}/critters-v${currentVersion}.bak`;
    copyFileSync(process.execPath, backupPath);
    print(`Backup saved to ${backupPath}`);
    renameSync(tempPath, process.execPath);
    print(`Update applied (v${currentVersion} → v${latestVersion}). Restart the daemon manually to use the new version.`);
    return true;
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // best-effort cleanup
    }

    // Attempt to restore from backup
    const backupPath = `${dirname(process.execPath)}/critters-v${currentVersion}.bak`;
    try {
      if (existsSync(backupPath)) {
        copyFileSync(backupPath, process.execPath);
        printError(`Restored previous binary from ${backupPath}`);
      }
    } catch {
      // best-effort restore — if this fails too, the error message below still prints
    }

    printError(`Update failed: ${formatError(err)}`);
    return false;
  }
}
