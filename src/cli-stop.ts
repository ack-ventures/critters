import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
    // Health endpoint unreachable — try PID file fallback
    const pidFile = join(homedir(), ".critters", "critters.pid");
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, "SIGTERM");
          // Clean up PID file — the daemon's shutdown handler will also try,
          // but it may not run if the process was stuck. Double-delete is safe.
          try { unlinkSync(pidFile); } catch {}
          console.log(`Sent SIGTERM to critters daemon (PID ${pid})`);
          return;
        }
      } catch {
        // PID file exists but process can't be killed
      }
    }
    console.error("Critters daemon is not running (or health endpoint is disabled)");
    process.exit(1);
  }
}
