import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

function getKickoffConfig(): { healthPort: number } {
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
        };
      } catch {
        // Fall through to defaults
      }
    }
  }

  return { healthPort: 3847 };
}

export async function runKickoff(): Promise<void> {
  const config = getKickoffConfig();
  const baseUrl = `http://localhost:${config.healthPort}`;

  // Trigger both polls concurrently
  const [pollResult, reviewResult] = await Promise.allSettled([
    fetch(`${baseUrl}/poll`, { method: "POST" }).then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`${resp.status} ${await resp.text()}`);
      }
      return resp.json() as Promise<{ triggered: boolean; issuesFound: number }>;
    }),
    fetch(`${baseUrl}/review-poll`, { method: "POST" }).then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`${resp.status} ${await resp.text()}`);
      }
      return resp.json() as Promise<{ triggered: boolean; issuesFound: number }>;
    }),
  ]);

  // If both failed, daemon is likely not running
  if (pollResult.status === "rejected" && reviewResult.status === "rejected") {
    console.error("Critters daemon is not running (or health endpoint is disabled)");
    process.exit(1);
  }

  // Report results, showing partial results if one failed
  const critterIssues = pollResult.status === "fulfilled" ? pollResult.value.issuesFound : null;
  const reviewIssues = reviewResult.status === "fulfilled" ? reviewResult.value.issuesFound : null;

  const parts: string[] = [];
  if (critterIssues !== null) {
    parts.push(`${critterIssues} critter issues`);
  } else {
    parts.push("critter poll failed");
  }
  if (reviewIssues !== null) {
    parts.push(`${reviewIssues} review issues`);
  } else {
    parts.push("review poll failed");
  }

  console.log(`Poll triggered. Found ${parts.join(", ")}.`);
}
