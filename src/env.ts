import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Load ~/.critters/.env as fallback if CWD .env doesn't exist.
 * Sets env vars that aren't already set in process.env.
 */
export function loadEnvFallback(): void {
  const cwdEnv = "./.env";
  const userEnv = `${homedir()}/.critters/.env`;
  if (!existsSync(cwdEnv) && existsSync(userEnv)) {
    const envContent = readFileSync(userEnv, "utf-8");
    for (const line of envContent.split("\n")) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Support a leading `export ` prefix (common in shell-style .env files).
      if (trimmed.startsWith("export ")) {
        trimmed = trimmed.slice("export ".length).trim();
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip a matching surrounding quote pair so a quoted token doesn't leak
      // its quotes into the value (e.g. KEY="lin_..." → lin_...). Mirrors Bun's
      // native CWD .env loader, which this fallback otherwise diverges from.
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
