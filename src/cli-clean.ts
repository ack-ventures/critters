import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { loadWorkDir } from "./config.js";
import { formatDuration } from "./utils.js";

function getDirSize(dirPath: string): number {
  let total = 0;
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = `${dirPath}/${entry.name}`;
    if (entry.isDirectory()) {
      total += getDirSize(fullPath);
    } else {
      try {
        total += statSync(fullPath).size;
      } catch { /* skip unreadable files */ }
    }
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export async function runClean(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const configIdx = args.indexOf("--config");
  const configPath = configIdx !== -1 && args[configIdx + 1] ? args[configIdx + 1] : undefined;
  const workDir = loadWorkDir(configPath);

  if (!existsSync(workDir)) {
    console.log(`No work directory found at ${workDir}`);
    return;
  }

  const entries = readdirSync(workDir, { encoding: "utf-8" });
  if (entries.length === 0) {
    console.log(`No directories found in ${workDir}`);
    return;
  }

  console.log(`Work directory: ${workDir}\n`);

  const STALE_THRESHOLD_MS = 60 * 60_000; // 60 minutes
  let totalFreed = 0;
  let cleanedCount = 0;

  const dirs: { name: string; ageMs: number; size: number; stale: boolean }[] = [];

  for (const entry of entries) {
    const fullPath = `${workDir}/${entry}`;
    try {
      const stats = statSync(fullPath);
      if (!stats.isDirectory()) continue;
      const ageMs = Date.now() - stats.mtimeMs;
      const size = getDirSize(fullPath);
      const stale = all || ageMs >= STALE_THRESHOLD_MS;
      dirs.push({ name: entry, ageMs, size, stale });
    } catch {
      console.warn(`  Warning: could not stat ${entry}, skipping`);
    }
  }

  if (dirs.length === 0) {
    console.log(`No directories found in ${workDir}`);
    return;
  }

  for (const dir of dirs) {
    const label = dir.stale ? "stale" : "active";
    console.log(`  ${dir.name}  ${formatDuration(dir.ageMs)}   ${formatSize(dir.size)}  ${label}`);
  }

  const toRemove = dirs.filter((d) => d.stale);

  if (toRemove.length === 0) {
    console.log("\nNo stale directories to clean up");
    return;
  }

  totalFreed = toRemove.reduce((sum, d) => sum + d.size, 0);
  cleanedCount = toRemove.length;

  if (dryRun) {
    console.log(`\nWould clean up ${cleanedCount} directories, freeing ${formatSize(totalFreed)}`);
    return;
  }

  for (const dir of toRemove) {
    try {
      rmSync(`${workDir}/${dir.name}`, { recursive: true, force: true });
    } catch (err) {
      console.warn(`  Warning: failed to remove ${dir.name}: ${err instanceof Error ? err.message : String(err)}`);
      cleanedCount--;
      totalFreed -= dir.size;
    }
  }

  console.log(`\nCleaned up ${cleanedCount} directories, freed ${formatSize(totalFreed)}`);
}
