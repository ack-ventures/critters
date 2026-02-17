import { appendFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let logFile: string | null = null;
let storedMaxLogSizeMb = 10;
let writeCount = 0;

export function rotateFileIfNeeded(filePath: string, maxSizeMb: number, maxFiles: number = 3): void {
  try {
    const size = Bun.file(filePath).size;
    if (size <= maxSizeMb * 1024 * 1024) return;

    // Shift existing rotated files
    for (let i = maxFiles; i >= 1; i--) {
      const current = `${filePath}.${i}`;
      if (i === maxFiles) {
        if (existsSync(current)) unlinkSync(current);
      } else {
        if (existsSync(current)) renameSync(current, `${filePath}.${i + 1}`);
      }
    }

    // Rotate the main file
    renameSync(filePath, `${filePath}.1`);
  } catch (err) {
    console.warn(`Log rotation failed for ${filePath}: ${err}`);
  }
}

export function initFileLogging(maxLogSizeMb: number = 10, logDir?: string): void {
  const dir = logDir ?? join(homedir(), ".critters");
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, "critters.log");
  storedMaxLogSizeMb = maxLogSizeMb;

  rotateFileIfNeeded(logFile, maxLogSizeMb, 3);

  const timer = setInterval(() => {
    try {
      if (logFile) rotateFileIfNeeded(logFile, storedMaxLogSizeMb, 3);
    } catch (_) {
      // never crash the daemon
    }
  }, 3600000);
  timer.unref();
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, message: string, args: unknown[]): void {
  const suffix = args.length > 0 ? ` ${args.map(String).join(" ")}` : "";
  const formatted = `[${timestamp()}] ${level}${message}${suffix}`;
  if (logFile) {
    appendFileSync(logFile, `${formatted}\n`);
    writeCount++;
    if (writeCount % 1000 === 0) {
      try {
        rotateFileIfNeeded(logFile, storedMaxLogSizeMb, 3);
      } catch (_) {
        // never crash the daemon
      }
    }
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
