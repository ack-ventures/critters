import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Subprocess } from "bun";
import { parse as parseYaml } from "yaml";
import { STREAM_FILTER } from "./jq-filter.js";
import { renderReadableLines, resolveCliAdapterForLog } from "./log-resolver.js";

const FILTER_TMP_PATH = "/tmp/critters-tail-filter.jq";

const COLORS = [
  "\x1b[36m", // cyan
  "\x1b[32m", // green
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[34m", // blue
  "\x1b[91m", // bright red
];
const RESET = "\x1b[0m";

const PHASE_TO_FILE_TAG: Record<string, string> = {
  planning: "plan",
  execution: "exec",
  review: "review",
};

interface TailConfig {
  healthPort: number;
  workDir: string;
}

interface ActiveDetail {
  identifier: string;
  title: string;
  phase: string;
  repo: string;
  branch: string;
  elapsed: string;
  critterType: string | null;
  workDir: string | null;
}

interface TrackedProcess {
  proc?: Subprocess;
  interval?: Timer;
  reader: Promise<void>;
  phase: string;
}

function getTailConfig(configPath?: string): TailConfig {
  const candidates = configPath
    ? [configPath]
    : ["./critters.config.yaml", `${homedir()}/.critters/config.yaml`];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const yaml = parseYaml(raw) as Record<string, unknown>;
        return {
          healthPort: (yaml.healthPort as number) ?? 3847,
          workDir: (yaml.workDir as string) ?? "/tmp/critters-work",
        };
      } catch {
        // Fall through
      }
    }
  }

  return { healthPort: 3847, workDir: "/tmp/critters-work" };
}

function parseArgs(args: string[]): { configPath?: string; typeFilter?: string } {
  let configPath: string | undefined;
  let typeFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") {
      configPath = args[++i];
    } else if (arg === "--type") {
      typeFilter = args[++i];
    }
  }

  return { configPath, typeFilter };
}

function phaseFileTag(phaseName: string): string {
  return PHASE_TO_FILE_TAG[phaseName] ?? phaseName;
}

const colorMap = new Map<string, string>();
let colorIdx = 0;

function getColor(identifier: string): string {
  if (!colorMap.has(identifier)) {
    colorMap.set(identifier, COLORS[colorIdx % COLORS.length]);
    colorIdx++;
  }
  return colorMap.get(identifier) as string;
}

function writeFilterFile(): void {
  writeFileSync(FILTER_TMP_PATH, STREAM_FILTER, "utf-8");
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    }
  }
}

function startTail(identifier: string, phase: string, logFile: string): TrackedProcess {
  const adapter = resolveCliAdapterForLog(logFile);
  if (!adapter.getDisplayFilter()) {
    return startTailWithoutFilter(identifier, phase, logFile);
  }

  const color = getColor(identifier);
  const prefix = `${color}[${identifier}/${phaseFileTag(phase)}]${RESET}`;

  const proc = Bun.spawn(
    ["sh", "-c", `tail -n 0 -f ${JSON.stringify(logFile)} | jq -cr --unbuffered --arg tool_color '\\x1b[36m' -f ${JSON.stringify(FILTER_TMP_PATH)}`],
    { stdout: "pipe", stderr: "ignore" },
  );

  const readerPromise = readLines(proc.stdout as ReadableStream<Uint8Array>, prefix).catch(() => {});

  return { proc, reader: readerPromise, phase };
}

function startTailWithoutFilter(identifier: string, phase: string, logFile: string): TrackedProcess {
  const color = getColor(identifier);
  const prefix = `${color}[${identifier}/${phaseFileTag(phase)}]${RESET}`;
  const adapter = resolveCliAdapterForLog(logFile);
  let fileOffset = 0;

  const readerPromise = (async () => {
    try {
      const initial = readFileSync(logFile, "utf-8");
      fileOffset = Buffer.byteLength(initial);
      const initialLines = initial.split("\n").filter((line) => line.trim());
      for (const line of renderReadableLines(initialLines, adapter)) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    } catch {
      // Poller may recover if the file becomes readable shortly afterwards.
    }
  })();

  const interval = setInterval(async () => {
    try {
      const file = Bun.file(logFile);
      const currentSize = file.size;
      if (currentSize <= fileOffset) return;

      const slice = await file.slice(fileOffset, currentSize).text();
      fileOffset = currentSize;
      const lines = slice.split("\n").filter((line) => line.trim());
      for (const line of renderReadableLines(lines, adapter)) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    } catch {
      // Keep polling on transient read errors.
    }
  }, 500);
  interval.unref();

  return { interval, reader: readerPromise, phase };
}

async function fetchActiveDetails(healthPort: number): Promise<ActiveDetail[]> {
  const resp = await fetch(`http://localhost:${healthPort}/healthz`);
  const data = await resp.json() as { activeCritterDetails: ActiveDetail[] };
  return data.activeCritterDetails ?? [];
}

export async function tailCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = getTailConfig(parsed.configPath);

  // Fetch initial active critters
  let details: ActiveDetail[];
  try {
    details = await fetchActiveDetails(config.healthPort);
  } catch {
    console.error("Critters daemon is not running (or health endpoint is disabled)");
    process.exit(1);
  }

  // Filter by type if requested
  if (parsed.typeFilter) {
    details = details.filter((d) => d.critterType === parsed.typeFilter);
  }

  if (details.length === 0) {
    console.log(parsed.typeFilter ? `No active critters of type "${parsed.typeFilter}"` : "No active critters");
    process.exit(0);
  }

  writeFilterFile();

  // Track active tail processes
  const tracked = new Map<string, TrackedProcess>();

  // Start tailing each active critter
  for (const d of details) {
    const logFile = resolveLogFile(d);
    if (!logFile) continue;
    const tp = startTail(d.identifier, d.phase, logFile);
    tracked.set(d.identifier, tp);
    const color = getColor(d.identifier);
    console.log(`${color}[${d.identifier}]${RESET} Tailing ${d.phase} phase — ${d.repo} (${d.elapsed})`);
  }

  if (tracked.size === 0) {
    console.log("No active critters with accessible log files");
    process.exit(0);
  }

  // Periodic poll for changes
  const pollInterval = setInterval(async () => {
    try {
      let current = await fetchActiveDetails(config.healthPort);
      if (parsed.typeFilter) {
        current = current.filter((d) => d.critterType === parsed.typeFilter);
      }

      const currentIds = new Set(current.map((d) => d.identifier));

      // Detect finished critters
      for (const [id, tp] of tracked) {
        if (!currentIds.has(id)) {
          const color = getColor(id);
          console.log(`${color}[${id} completed]${RESET}`);
          try { tp.proc?.kill(); } catch {}
          if (tp.interval) clearInterval(tp.interval);
          tracked.delete(id);
        }
      }

      // Detect new critters or phase changes
      for (const d of current) {
        const existing = tracked.get(d.identifier);
        if (!existing) {
          // New critter
          const logFile = resolveLogFile(d);
          if (!logFile) continue;
          const tp = startTail(d.identifier, d.phase, logFile);
          tracked.set(d.identifier, tp);
          const color = getColor(d.identifier);
          console.log(`${color}[${d.identifier}]${RESET} Tailing ${d.phase} phase — ${d.repo}`);
        } else if (existing.phase !== d.phase) {
          // Phase changed — kill old tail and start new one
          try { existing.proc?.kill(); } catch {}
          if (existing.interval) clearInterval(existing.interval);
          const logFile = resolveLogFile(d);
          if (!logFile) continue;
          const tp = startTail(d.identifier, d.phase, logFile);
          tracked.set(d.identifier, tp);
          const color = getColor(d.identifier);
          console.log(`${color}[${d.identifier}]${RESET} Phase changed to ${d.phase}`);
        }
      }

      // If all critters are done, exit
      if (tracked.size === 0 && current.length === 0) {
        console.log("All critters finished");
        cleanup();
        process.exit(0);
      }
    } catch {
      // Health server may have gone down — ignore and retry next cycle
    }
  }, 10_000);

  const cleanup = () => {
    clearInterval(pollInterval);
    for (const [, tp] of tracked) {
      try { tp.proc?.kill(); } catch {}
      if (tp.interval) clearInterval(tp.interval);
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  // Wait forever (until SIGINT or all critters finish)
  await new Promise(() => {});
}

function resolveLogFile(detail: ActiveDetail): string | null {
  if (!detail.workDir) return null;
  const tag = phaseFileTag(detail.phase);
  const logFile = `${detail.workDir}/.critter-output-${tag}.json`;
  if (!existsSync(logFile)) return null;
  return logFile;
}
