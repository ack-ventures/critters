import { spawn, type ChildProcess } from "child_process";
import type { SpawnResult } from "./types.js";
import { logTask } from "./logger.js";

export function spawnClaude(
  prompt: string,
  allowedTools: string[],
  workDir: string,
  maxTurns: number,
  identifier: string,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const args = [
      "-p", prompt,
      "--model", "opus",
      "--allowedTools", allowedTools.join(","),
      "--max-turns", String(maxTurns),
      "--output-format", "text",
    ];

    logTask(identifier, `Spawning Claude with ${allowedTools.length} allowed tools`);

    const proc: ChildProcess = spawn("claude", args, {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));

    const onAbort = () => {
      timedOut = true;
      proc.kill("SIGTERM");
      // Give it 5s to clean up, then force kill
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.on("close", (code) => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
