import { exec } from "node:child_process";
import { log, logTask, logTaskWarn } from "./logger.js";
import type { Config } from "./types.js";

export function runHook(
  hookName: string,
  command: string,
  env: Record<string, string>,
  identifier?: string,
): void {
  if (identifier) {
    logTask(identifier, `Running hook ${hookName}: ${command}`);
  } else {
    log(`Running hook ${hookName}: ${command}`);
  }

  exec(command, { env: { ...process.env, ...env }, timeout: 30_000 }, (error, stdout, stderr) => {
    if (error) {
      const msg = `Hook ${hookName} failed: ${error.message}`;
      if (identifier) {
        logTaskWarn(identifier, msg);
      } else {
        log(`WARN: ${msg}`);
      }
    } else if (stderr) {
      const msg = `Hook ${hookName} stderr: ${stderr}`;
      if (identifier) {
        logTaskWarn(identifier, msg);
      } else {
        log(`WARN: ${msg}`);
      }
    }

    if (stdout && stdout.trim()) {
      const msg = `Hook ${hookName} output: ${stdout.trim()}`;
      if (identifier) {
        logTask(identifier, msg);
      } else {
        log(msg);
      }
    }
  });
}

export function triggerHook(
  config: Config,
  hookName: keyof NonNullable<Config["hooks"]>,
  env: Record<string, string>,
  identifier?: string,
): void {
  const command = config.hooks?.[hookName];
  if (command) {
    runHook(hookName, command, env, identifier);
  }
}
