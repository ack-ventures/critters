import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let logFile: string | null = null;

export function initFileLogging(): void {
  const dir = join(homedir(), ".critters");
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, "critters.log");
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, message: string, args: unknown[]): void {
  const suffix = args.length > 0 ? ` ${args.map(String).join(" ")}` : "";
  const formatted = `[${timestamp()}] ${level}${message}${suffix}`;
  if (logFile) {
    appendFileSync(logFile, `${formatted}\n`);
  } else if (level.includes("ERROR")) {
    console.error(formatted);
  } else if (level.includes("WARN")) {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export function log(message: string, ...args: unknown[]): void {
  writeLog("", message, args);
}

export function logError(message: string, ...args: unknown[]): void {
  writeLog("ERROR: ", message, args);
}

export function logTask(identifier: string, message: string, ...args: unknown[]): void {
  writeLog(`[${identifier}] `, message, args);
}

export function logTaskWarn(identifier: string, message: string, ...args: unknown[]): void {
  writeLog(`[${identifier}] WARN: `, message, args);
}

export function logTaskError(identifier: string, message: string, ...args: unknown[]): void {
  writeLog(`[${identifier}] ERROR: `, message, args);
}
