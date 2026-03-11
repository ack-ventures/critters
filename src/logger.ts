import { appendFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let logFile: string | null = null;
let storedMaxLogSizeMb = 10;
let writeCount = 0;
let rotationTimer: ReturnType<typeof setInterval> | null = null;
let jsonMode = false;

export function enableJsonLogs(): void {
  jsonMode = true;
}

export function disableJsonLogs(): void {
  jsonMode = false;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

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

  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = setInterval(() => {
    try {
      if (logFile) rotateFileIfNeeded(logFile, storedMaxLogSizeMb, 3);
    } catch (_) {
      // never crash the daemon
    }
  }, 3600000);
  rotationTimer.unref();
}

export function resetFileLogging(): void {
  logFile = null;
  writeCount = 0;
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function colorizeForConsole(level: string, message: string, args: unknown[]): string {
  const ts = timestamp();
  const suffix = args.length > 0 ? ` ${args.map(String).join(" ")}` : "";
  const fullMessage = `${message}${suffix}`;

  const DIM = "\x1b[90m";
  const BOLD_CYAN = "\x1b[1;36m";
  const BOLD = "\x1b[1m";
  const BLUE = "\x1b[34m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";

  // Colorize timestamp: dim gray
  let result = `${DIM}[${ts}]${RESET} `;

  // Colorize level prefix
  if (level.includes("ERROR")) {
    result += `${RED}ERROR:${RESET} `;
  } else if (level.includes("WARN")) {
    result += `${YELLOW}WARN:${RESET} `;
  }

  // Extract task identifier from level (e.g., "[ACK-130] " or "[ACK-130] WARN: ")
  const identifierMatch = level.match(/^\[([A-Z]+-\d+)\]/);
  if (identifierMatch) {
    result = `${DIM}[${ts}]${RESET} ${BOLD_CYAN}[${identifierMatch[1]}]${RESET} `;
    // Re-add WARN/ERROR prefix after identifier if present
    if (level.includes("ERROR")) {
      result += `${RED}ERROR:${RESET} `;
    } else if (level.includes("WARN")) {
      result += `${YELLOW}WARN:${RESET} `;
    }
  }

  // Colorize the message body
  let coloredMessage = fullMessage;

  // Highlight URLs and absolute file paths (blue, require at least two segments)
  coloredMessage = coloredMessage.replace(
    /(https?:\/\/\S+|\/[\w.-]+\/[\w./-]+)/g,
    `${BLUE}$1${RESET}`
  );

  // Highlight lifecycle phrases (bold)
  const lifecyclePhrases = ["Starting Phase", "Plan approved", "PR created", "completed", "merged", "failed"];
  for (const phrase of lifecyclePhrases) {
    coloredMessage = coloredMessage.replaceAll(phrase, `${BOLD}${phrase}${RESET}`);
  }

  result += coloredMessage;
  return result;
}

export function formatJsonLogEntry(level: string, message: string, args: unknown[]): string {
  const suffix = args.length > 0 ? ` ${args.map(String).join(" ")}` : "";
  const identifierMatch = level.match(/^\[([A-Z]+-\d+)\]/);
  const identifier = identifierMatch ? identifierMatch[1] : undefined;
  const logLevel = level.includes("ERROR") ? "error" : level.includes("WARN") ? "warn" : "info";
  const entry: Record<string, string> = {
    timestamp: timestamp(),
    level: logLevel,
    message: `${message}${suffix}`,
  };
  if (identifier) {
    entry.identifier = identifier;
  }
  return JSON.stringify(entry) + "\n";
}

function writeJsonLog(level: string, message: string, args: unknown[]): void {
  const line = formatJsonLogEntry(level, message, args);
  const isError = level.includes("ERROR");

  if (logFile) {
    appendFileSync(logFile, line);
    writeCount++;
    if (writeCount % 1000 === 0) {
      try {
        rotateFileIfNeeded(logFile, storedMaxLogSizeMb, 3);
      } catch (_) {
        // never crash the daemon
      }
    }
  }

  if (isError) {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

function writeLog(level: string, message: string, args: unknown[]): void {
  if (jsonMode) {
    writeJsonLog(level, message, args);
    return;
  }

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
  }

  if (level.includes("ERROR")) {
    console.error(colorizeForConsole(level, message, args));
  } else if (level.includes("WARN")) {
    console.warn(colorizeForConsole(level, message, args));
  } else {
    console.log(colorizeForConsole(level, message, args));
  }
}

export function log(message: string, ...args: unknown[]): void {
  writeLog("", message, args);
}

export function logWarn(message: string, ...args: unknown[]): void {
  writeLog("WARN: ", message, args);
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
