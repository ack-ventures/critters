import { spawn } from "node:child_process";
import { log, logError } from "./logger.js";
import type { TunnelConfig } from "./types.js";
import { runCommand, sleep } from "./utils.js";

export interface TunnelHandle {
  url: string;
  stop: () => void;
}

export async function startTunnel(port: number, config: TunnelConfig): Promise<TunnelHandle | null> {
  // Check if ngrok is available
  const check = await runCommand("ngrok", ["version"]);
  if (check.code !== 0) {
    log("Warning: ngrok binary not found — tunnel disabled. Install from https://ngrok.com/download");
    return null;
  }

  // Build args
  const args = ["http", String(port), "--log", "stderr"];
  if (config.auth) {
    args.push("--basic-auth", config.auth);
  }
  if (config.domain) {
    args.push("--domain", config.domain);
  }

  // Spawn ngrok as long-running process
  const proc = spawn("ngrok", args, { stdio: ["ignore", "ignore", "ignore"] });

  let stopped = false;

  proc.on("error", (err) => {
    if (!stopped) {
      logError(`Tunnel process error: ${err.message}`);
    }
  });

  proc.on("exit", (code) => {
    if (!stopped) {
      log(`Warning: ngrok tunnel disconnected (exit code ${code})`);
    }
  });

  // Poll ngrok API to get the public URL
  let url: string | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(1000);
    try {
      const resp = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (resp.ok) {
        const data = (await resp.json()) as { tunnels: { public_url: string }[] };
        if (data.tunnels && data.tunnels.length > 0) {
          url = data.tunnels[0].public_url;
          break;
        }
      }
    } catch {
      // ngrok API not ready yet, retry
    }
  }

  if (!url) {
    log("Warning: could not obtain tunnel URL from ngrok API after 10 attempts — disabling tunnel");
    stopped = true;
    proc.kill();
    return null;
  }

  return {
    url,
    stop: () => {
      stopped = true;
      proc.kill();
    },
  };
}
