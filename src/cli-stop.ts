import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

function getStopConfig(): { healthPort: number; dashboardToken?: string } {
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

export async function runStop(): Promise<void> {
  const config = getStopConfig();
  const baseUrl = `http://localhost:${config.healthPort}`;

  const headers: Record<string, string> = {};
  if (config.dashboardToken) {
    headers.Authorization = `Bearer ${config.dashboardToken}`;
  }

  try {
    const resp = await fetch(`${baseUrl}/stop`, { method: "POST", headers });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Stop failed: ${resp.status} ${text}`);
      process.exit(1);
    }
    console.log("Stopping critters daemon...");
  } catch {
    console.error("Critters daemon is not running (or health endpoint is disabled)");
    process.exit(1);
  }
}
