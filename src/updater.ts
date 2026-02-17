import { chmodSync, existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { log, logError } from "./logger.js";

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

export async function checkForUpdate(currentVersion: string): Promise<void> {
  // Only auto-update when running as a compiled binary — when running via
  // `bun run src/index.ts`, process.execPath points to the bun binary and
  // we must not overwrite it.
  if (process.execPath.includes("bun")) return;

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
      logError(`Update check failed: GitHub API returned ${response.status}`);
      return;
    }

    const data = await response.json();
    const { tag_name, assets } = data as { tag_name: unknown; assets: unknown };

    if (typeof tag_name !== "string" || !Array.isArray(assets)) {
      logError("Update check failed: unexpected API response format");
      return;
    }

    const latestVersion = tag_name.replace(/^v/, "").replace(/-.*$/, "");

    if (compareSemver(latestVersion, currentVersion) <= 0) {
      return;
    }

    log(`Update available: v${currentVersion} → v${latestVersion}`);

    const expectedName = `critters-${process.platform}-${process.arch}`;
    const asset = assets.find(
      (a: { name?: string }) => a.name === expectedName,
    ) as { name: string; browser_download_url?: string } | undefined;

    if (!asset || typeof asset.browser_download_url !== "string") {
      logError(`Update: no valid binary asset found for ${process.platform}-${process.arch}`);
      return;
    }

    const downloadResponse = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!downloadResponse.ok) {
      logError(`Update download failed: HTTP ${downloadResponse.status}`);
      return;
    }

    const arrayBuffer = await downloadResponse.arrayBuffer();
    writeFileSync(tempPath, Buffer.from(arrayBuffer));
    chmodSync(tempPath, 0o755);
    renameSync(tempPath, process.execPath);
    log(`Update applied (v${currentVersion} → v${latestVersion}). Will take effect on next restart.`);
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // best-effort cleanup
    }
    logError(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
