import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { formatDuration } from "./utils.js";

function getKillConfig(): { healthPort: number; dashboardToken?: string } {
  const candidates = [
    "./critters.config.yaml",
    `${homedir()}/.critters/config.yaml`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const yaml = parseYaml(raw) as Record<string, unknown>;
        return {
          healthPort: (yaml.healthPort as number) ?? 3847,
          dashboardToken: (yaml.dashboardToken as string) ?? process.env.DASHBOARD_TOKEN ?? undefined,
        };
      } catch {
        // Fall through to defaults
      }
    }
  }

  return { healthPort: 3847 };
}

export async function runKill(args: string[]): Promise<void> {
  // Parse arguments
  let identifier: string | undefined;
  let killAll = false;
  let typeName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") {
      killAll = true;
    } else if (arg === "--type") {
      typeName = args[++i];
      if (!typeName) {
        console.error("Error: --type requires a name argument.\nUsage: critters kill <identifier>\n       critters kill --all\n       critters kill --type <name>");
        process.exit(1);
      }
    } else if (!arg.startsWith("-")) {
      identifier = arg;
    }
  }

  // Validate: exactly one mode
  const modes = [identifier, killAll, typeName].filter(Boolean).length;
  if (modes === 0) {
    console.error("Usage: critters kill <identifier>\n       critters kill --all\n       critters kill --type <name>");
    process.exit(1);
  }
  if (modes > 1) {
    console.error("Error: Specify exactly one of <identifier>, --all, or --type <name>.");
    process.exit(1);
  }

  const config = getKillConfig();
  const baseUrl = `http://localhost:${config.healthPort}`;
  const headers: Record<string, string> = {};
  if (config.dashboardToken) {
    headers.Authorization = `Bearer ${config.dashboardToken}`;
  }

  // Query /healthz to get active critter details
  let activeCritterDetails: Array<{
    identifier: string;
    critterType: string | null;
    elapsed: string;
    startedAt?: number;
  }>;

  try {
    const healthResp = await fetch(`${baseUrl}/healthz`);
    if (!healthResp.ok) {
      console.error(`Failed to query daemon status: ${healthResp.status}`);
      process.exit(1);
    }
    const healthData = await healthResp.json() as { activeCritterDetails: typeof activeCritterDetails };
    activeCritterDetails = healthData.activeCritterDetails;
  } catch {
    console.error("Critters daemon is not running (or health endpoint is disabled)");
    process.exit(1);
  }

  // Determine which critters to kill
  let toKill: typeof activeCritterDetails;

  if (identifier) {
    toKill = activeCritterDetails.filter((d) => d.identifier === identifier);
    if (toKill.length === 0) {
      console.error(`Error: No running critter with identifier "${identifier}".`);
      process.exit(1);
    }
  } else if (typeName) {
    toKill = activeCritterDetails.filter((d) => d.critterType === typeName);
    if (toKill.length === 0) {
      console.error(`Error: No running critters of type "${typeName}".`);
      process.exit(1);
    }
  } else {
    // --all
    toKill = activeCritterDetails;
    if (toKill.length === 0) {
      console.error("Error: No critters are currently running.");
      process.exit(1);
    }
  }

  const identifiers = toKill.map((d) => d.identifier);

  // Send POST /kill
  try {
    const resp = await fetch(`${baseUrl}/kill`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Kill failed: ${resp.status} ${text}`);
      process.exit(1);
    }

    const results = await resp.json() as Array<{ identifier: string; critterType: string; startedAt: number }>;

    for (const r of results) {
      const elapsed = formatDuration(Date.now() - r.startedAt);
      console.log(`Killed ${r.identifier} (type: ${r.critterType}, ran for ${elapsed})`);
    }

    if (results.length === 0) {
      // Fallback: print from our local data
      for (const d of toKill) {
        console.log(`Killed ${d.identifier} (type: ${d.critterType ?? "unknown"}, elapsed: ${d.elapsed})`);
      }
    }
  } catch (err) {
    console.error(`Failed to send kill request: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
