import { chmodSync, existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { log, logError } from "./logger.js";

// Canonical release source — update this if the repo ever moves.
const RELEASES_URL = "https://api.github.com/repos/ack-ventures/critters/releases/latest";

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdate(
  currentVersion: string,
  opts?: { force?: boolean },
): Promise<void> {
  const force = opts?.force ?? false;
  const print = force ? console.log.bind(console) : log;
  const printError = force ? console.error.bind(console) : logError;

  // Only auto-update when running as a compiled binary — when running via
  // `bun run src/index.ts`, process.execPath points to the bun binary and
  // we must not overwrite it.
  if (process.execPath.includes("bun")) {
    if (force) printError("Cannot update: running via bun, not as a compiled binary. Use install.sh to install.");
    return;
  }

  if (currentVersion === "dev") {
    if (force) printError("Cannot check for updates: running a dev build.");
    return;
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
      return;
    }

    const data = await response.json();
    const { tag_name, assets } = data as { tag_name: unknown; assets: unknown };

    if (typeof tag_name !== "string" || !Array.isArray(assets)) {
      printError("Update check failed: unexpected API response format");
      return;
    }

    const latestVersion = tag_name.replace(/^v/, "").replace(/-.*$/, "");

    if (compareSemver(latestVersion, currentVersion) <= 0) {
      if (force) print(`Already up to date (v${currentVersion})`);
      return;
    }

    print(`Update available: v${currentVersion} → v${latestVersion}`);

    const expectedName = `critters-${process.platform}-${process.arch}`;
    const asset = assets.find(
      (a: { name?: string }) => a.name === expectedName,
    ) as { name: string; browser_download_url?: string } | undefined;

    if (!asset || typeof asset.browser_download_url !== "string") {
      printError(`Update: no valid binary asset found for ${process.platform}-${process.arch}`);
      return;
    }

    const downloadResponse = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!downloadResponse.ok) {
      printError(`Update download failed: HTTP ${downloadResponse.status}`);
      return;
    }

    const arrayBuffer = await downloadResponse.arrayBuffer();
    writeFileSync(tempPath, Buffer.from(arrayBuffer));
    chmodSync(tempPath, 0o755);
    renameSync(tempPath, process.execPath);
    print(`Update applied (v${currentVersion} → v${latestVersion}). Will take effect on next restart.`);
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // best-effort cleanup
    }
    printError(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
