import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { loadWorkDir, resolveConfigPath } from "./config.js";
import { loadEnvFallback } from "./env.js";
import { deleteRemoteBranch } from "./git.js";
import { createTracker } from "./tracker/index.js";
import type { IssueTracker } from "./tracker/types.js";
import { extractOwnerRepo, formatDuration, runCommand } from "./utils.js";

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
  const dryRun = args.includes("--dry-run");
  const configIdx = args.indexOf("--config");
  const configPath = configIdx !== -1 && args[configIdx + 1] ? args[configIdx + 1] : undefined;

  if (args.includes("--branches")) {
    await cleanStaleBranches(configPath, dryRun);
    return;
  }

  // Existing directory cleanup logic
  const all = args.includes("--all");
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
      console.log(`  Scanning ${entry}...`);
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
      console.log(`  Removing ${dir.name}...`);
      rmSync(`${workDir}/${dir.name}`, { recursive: true, force: true });
    } catch (err) {
      console.warn(`  Warning: failed to remove ${dir.name}: ${err instanceof Error ? err.message : String(err)}`);
      cleanedCount--;
      totalFreed -= dir.size;
    }
  }

  console.log(`\nCleaned up ${cleanedCount} directories, freed ${formatSize(totalFreed)}`);
}

// ── Branch cleanup ──────────────────────────────────────────────────────────

const STALE_BRANCH_AGE_DAYS = 7;
const STALE_BRANCH_AGE_MS = STALE_BRANCH_AGE_DAYS * 24 * 60 * 60_000;

const TERMINAL_STATES = new Set(["Done", "Cancelled", "Canceled", "Critter Failed"]);

interface BranchCleanConfig {
  repos: Record<string, { url: string }>;
  teamRepos: Record<string, string>;
  branchPrefix: string;
  provider: string;
  jiraStatusMap?: Record<string, string>;
}

function loadBranchCleanConfig(configPath?: string): BranchCleanConfig {
  const resolved = resolveConfigPath(configPath);
  const raw = readFileSync(resolved, "utf-8");
  const yaml = parseYaml(raw) as Record<string, unknown>;

  const repos: Record<string, { url: string }> = {};
  if (yaml.repos && typeof yaml.repos === "object") {
    for (const [key, val] of Object.entries(yaml.repos as Record<string, unknown>)) {
      const v = val as Record<string, unknown>;
      repos[key] = { url: v.url as string };
    }
  }

  const teamRepos: Record<string, string> = {};
  if (yaml.teamRepos && typeof yaml.teamRepos === "object") {
    for (const [key, val] of Object.entries(yaml.teamRepos as Record<string, string>)) {
      teamRepos[key] = val;
    }
  }

  return {
    repos,
    teamRepos,
    branchPrefix: (yaml.branchPrefix as string) ?? "critter",
    provider: (yaml.provider as string) ?? "linear",
    jiraStatusMap: (yaml.jiraStatusMap as Record<string, string>) ?? undefined,
  };
}

function buildTerminalStates(jiraStatusMap?: Record<string, string>): Set<string> {
  const states = new Set(TERMINAL_STATES);
  if (jiraStatusMap) {
    for (const [internal, jiraName] of Object.entries(jiraStatusMap)) {
      if (TERMINAL_STATES.has(internal)) {
        states.add(jiraName);
      }
    }
  }
  return states;
}

function extractIdentifier(branch: string, prefix: string): string | null {
  const afterPrefix = branch.slice(prefix.length + 1); // e.g. "ACK-123-fix-login-bug"
  const match = afterPrefix.match(/^([A-Za-z][A-Za-z0-9]*-\d+)/);
  return match ? match[1] : null;
}

async function initTracker(config: BranchCleanConfig): Promise<IssueTracker | null> {
  loadEnvFallback();
  try {
    const providerConfig = config.provider === "jira"
      ? {
          type: "jira" as const,
          host: process.env.JIRA_HOST,
          email: process.env.JIRA_EMAIL,
          apiToken: process.env.JIRA_API_TOKEN,
          statusMap: config.jiraStatusMap,
        }
      : {
          type: "linear" as const,
          apiKey: process.env.LINEAR_API_KEY,
        };
    const tracker = createTracker(providerConfig);
    await tracker.init();
    return tracker;
  } catch (err) {
    console.warn(`Warning: Could not initialize tracker — will use age-based detection only (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

async function cleanStaleBranches(configPath: string | undefined, dryRun: boolean): Promise<void> {
  const config = loadBranchCleanConfig(configPath);
  const tracker = await initTracker(config);
  const terminalStates = buildTerminalStates(config.jiraStatusMap);

  // Collect unique repo URLs
  const repoUrls = new Set<string>();
  for (const repo of Object.values(config.repos)) {
    repoUrls.add(repo.url);
  }
  for (const url of Object.values(config.teamRepos)) {
    repoUrls.add(url);
  }

  if (repoUrls.size === 0) {
    console.log("No repos configured — nothing to scan");
    return;
  }

  let totalStale = 0;
  let totalDeleted = 0;
  let reposScanned = 0;

  for (const repoUrl of repoUrls) {
    const ownerRepo = extractOwnerRepo(repoUrl);
    if (!ownerRepo) {
      console.warn(`Warning: Could not extract owner/repo from ${repoUrl}, skipping`);
      continue;
    }

    // List remote branches
    const { code, stdout, stderr } = await runCommand("git", ["ls-remote", "--heads", repoUrl]);
    if (code !== 0) {
      console.warn(`Warning: git ls-remote failed for ${ownerRepo}: ${stderr.trim()}`);
      continue;
    }

    reposScanned++;
    const branchPrefix = config.branchPrefix;
    const branchLines = stdout.trim().split("\n").filter(Boolean);

    // Pre-filter to critter branches with valid identifiers
    const critterBranches: { sha: string; branchName: string; identifier: string }[] = [];
    for (const line of branchLines) {
      const [sha, ref] = line.split("\t");
      if (!ref) continue;
      const branchName = ref.replace("refs/heads/", "");
      if (!branchName.startsWith(`${branchPrefix}/`)) continue;
      const identifier = extractIdentifier(branchName, branchPrefix);
      if (!identifier) continue;
      critterBranches.push({ sha, branchName, identifier });
    }

    interface BranchInfo {
      name: string;
      sha: string;
      reason: string;
      stale: boolean;
    }
    const branches: BranchInfo[] = [];

    if (critterBranches.length === 0) {
      console.log(`No critter branches found in ${ownerRepo}`);
      continue;
    }

    console.log(`Scanning ${critterBranches.length} critter branches in ${ownerRepo}...`);

    for (let i = 0; i < critterBranches.length; i++) {
      const { sha, branchName, identifier } = critterBranches[i];
      const progress = `(${i + 1}/${critterBranches.length})`;

      // Check for PRs
      const prResult = await runCommand("gh", [
        "pr", "list", "--head", branchName, "--state", "all",
        "--json", "number,state", "--repo", ownerRepo, "--limit", "100",
      ]);

      let prs: { number: number; state: string }[] = [];
      if (prResult.code === 0 && prResult.stdout.trim()) {
        try {
          prs = JSON.parse(prResult.stdout.trim());
        } catch {
          // treat as no PRs
        }
      }

      const openPr = prs.find((pr) => pr.state === "OPEN");
      if (openPr) {
        console.log(`  ${progress} ${branchName}  open PR #${openPr.number}  skip`);
        branches.push({ name: branchName, sha, reason: `open PR #${openPr.number}`, stale: false });
        continue;
      }

      const mergedOrClosedPr = prs.find((pr) => pr.state === "MERGED") ?? prs.find((pr) => pr.state === "CLOSED");
      if (mergedOrClosedPr) {
        const pr = mergedOrClosedPr;
        const reason = `${pr.state.toLowerCase()} PR #${pr.number}`;
        console.log(`  ${progress} ${branchName}  ${reason}  stale`);
        branches.push({ name: branchName, sha, reason, stale: true });
        continue;
      }

      // No PR — check issue status via tracker
      if (tracker) {
        try {
          const issue = await tracker.findIssueByIdentifier(identifier);
          if (issue && terminalStates.has(issue.statusName)) {
            const reason = `no PR, issue ${issue.statusName}`;
            console.log(`  ${progress} ${branchName}  ${reason}  stale`);
            branches.push({ name: branchName, sha, reason, stale: true });
            continue;
          }
          if (issue) {
            console.log(`  ${progress} ${branchName}  no PR, issue ${issue.statusName}  skip`);
            branches.push({ name: branchName, sha, reason: `no PR, issue ${issue.statusName}`, stale: false });
            continue;
          }
        } catch {
          // Fall through to age check
        }
      }

      // No PR, no issue found (or tracker unavailable) — check commit age
      const ageResult = await runCommand("gh", [
        "api", `repos/${ownerRepo}/commits/${sha}`,
        "--jq", ".commit.committer.date",
      ]);

      if (ageResult.code === 0 && ageResult.stdout.trim()) {
        const commitDate = new Date(ageResult.stdout.trim());
        const ageMs = Date.now() - commitDate.getTime();
        const ageDays = Math.floor(ageMs / (24 * 60 * 60_000));

        if (ageMs >= STALE_BRANCH_AGE_MS) {
          const reason = `no PR, ${ageDays} days old`;
          console.log(`  ${progress} ${branchName}  ${reason}  stale`);
          branches.push({ name: branchName, sha, reason, stale: true });
        } else {
          console.log(`  ${progress} ${branchName}  no PR, ${ageDays} days old  skip`);
          branches.push({ name: branchName, sha, reason: `no PR, ${ageDays} days old`, stale: false });
        }
      } else {
        console.log(`  ${progress} ${branchName}  could not determine age  skip`);
        branches.push({ name: branchName, sha, reason: "unknown age", stale: false });
      }
    }

    const staleBranches = branches.filter((b) => b.stale);
    totalStale += staleBranches.length;

    if (staleBranches.length === 0) {
      console.log(`  No stale branches found\n`);
      continue;
    }

    if (dryRun) {
      console.log(`\nWould delete ${staleBranches.length} stale branches from ${ownerRepo}\n`);
      continue;
    }

    // Delete stale branches
    console.log("");
    for (const branch of staleBranches) {
      try {
        await deleteRemoteBranch(repoUrl, branch.name);
        console.log(`Deleted stale branch: ${branch.name} from ${ownerRepo}`);
        totalDeleted++;
      } catch (err) {
        console.warn(`Warning: Failed to delete ${branch.name} from ${ownerRepo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log("");
  }

  if (reposScanned === 0) {
    console.log("No repos could be scanned");
    return;
  }

  if (totalStale === 0) {
    console.log("No stale branches found across all repos");
    return;
  }

  if (dryRun) {
    console.log(`Would delete ${totalStale} stale branches across ${reposScanned} repo${reposScanned > 1 ? "s" : ""}`);
  } else {
    console.log(`Cleaned up ${totalDeleted} stale branches across ${reposScanned} repo${reposScanned > 1 ? "s" : ""}`);
  }
}
