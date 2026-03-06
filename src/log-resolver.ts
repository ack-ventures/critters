import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const PHASE_FILE_MAP: Record<string, string> = {
  planning: "plan",
  execution: "exec",
  review: "review",
};

export function phaseFileTag(phase: string): string {
  return PHASE_FILE_MAP[phase] ?? phase;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes use control characters by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function extractTimestamp(dirName: string): number {
  const parts = dirName.split("-");
  return parseInt(parts[parts.length - 1], 10);
}

function newestDir(dirs: string[]): string {
  return dirs.sort((a, b) => extractTimestamp(b) - extractTimestamp(a))[0];
}

export function findWorkDirs(workDir: string, identifier: string): { critterDirs: string[]; reviewDirs: string[] } {
  if (!existsSync(workDir)) {
    return { critterDirs: [], reviewDirs: [] };
  }

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const critterDirPattern = new RegExp(`^${escaped}-\\d+$`);
  const reviewDirPattern = new RegExp(`^review-${escaped}-\\d+$`);

  const entries = readdirSync(workDir);
  const critterDirs = entries.filter((e) => critterDirPattern.test(e));
  const reviewDirs = entries.filter((e) => reviewDirPattern.test(e));

  return { critterDirs, reviewDirs };
}

export function resolveWorkDirForIdentifier(workDir: string, identifier: string): string | null {
  const { critterDirs, reviewDirs } = findWorkDirs(workDir, identifier);
  const allDirs = [...critterDirs, ...reviewDirs];
  if (allDirs.length === 0) return null;
  return `${workDir}/${newestDir(allDirs)}`;
}

export function resolveLogFile(dir: string, phase?: string): string | null {
  if (phase) {
    const tag = phaseFileTag(phase);
    const logFile = `${dir}/.critter-output-${tag}.json`;
    if (existsSync(logFile) && statSync(logFile).size > 0) return logFile;
    return null;
  }

  // Auto-detect: review > execution > planning
  for (const p of ["review", "execution", "planning"]) {
    const tag = phaseFileTag(p);
    const logFile = `${dir}/.critter-output-${tag}.json`;
    if (existsSync(logFile) && statSync(logFile).size > 0) return logFile;
  }

  // Check for custom phase files
  try {
    const entries = readdirSync(dir);
    const logFiles = entries.filter((e) => e.startsWith(".critter-output-") && e.endsWith(".json"));
    if (logFiles.length > 0) {
      // Pick the most recently modified
      logFiles.sort((a, b) => {
        const sa = statSync(`${dir}/${a}`);
        const sb = statSync(`${dir}/${b}`);
        return sb.mtimeMs - sa.mtimeMs;
      });
      const logFile = `${dir}/${logFiles[0]}`;
      if (statSync(logFile).size > 0) return logFile;
    }
  } catch {}

  return null;
}

export function resolveAllPhases(dir: string): Array<{ phase: string; logFile: string }> {
  const results: Array<{ phase: string; logFile: string }> = [];

  try {
    const entries = readdirSync(dir);
    const logFiles = entries.filter((e) => e.startsWith(".critter-output-") && e.endsWith(".json"));

    // Reverse map: file tag -> display name
    const tagToPhase: Record<string, string> = {
      plan: "planning",
      exec: "execution",
      review: "review",
    };

    for (const f of logFiles) {
      const match = f.match(/^\.critter-output-(.+)\.json$/);
      if (!match) continue;
      const tag = match[1];
      const phaseName = tagToPhase[tag] ?? tag;
      const fullPath = `${dir}/${f}`;
      if (statSync(fullPath).size > 0) {
        results.push({ phase: phaseName, logFile: fullPath });
      }
    }
  } catch {}

  // Sort: planning first, then execution, then review, then custom
  const order: Record<string, number> = { planning: 0, execution: 1, review: 2 };
  results.sort((a, b) => (order[a.phase] ?? 99) - (order[b.phase] ?? 99));

  return results;
}

export function readLogTail(logFile: string, lines: number): string {
  try {
    const content = readFileSync(logFile, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim());
    const tail = allLines.slice(-lines);
    return extractReadableContent(tail);
  } catch {
    return "";
  }
}

function extractReadableContent(jsonLines: string[]): string {
  const output: string[] = [];

  for (const line of jsonLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant" && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === "text" && block.text) {
            output.push(stripAnsi(block.text));
          } else if (block.type === "tool_use") {
            output.push(stripAnsi(`[Tool: ${block.name}]`));
          }
        }
      } else if (obj.type === "result" && obj.result) {
        output.push(stripAnsi(`[Result: cost=$${(obj.cost_usd ?? 0).toFixed(2)}, turns=${obj.num_turns ?? "?"}]`));
      }
    } catch {
      // Not valid JSON, include raw line stripped of ANSI
      output.push(stripAnsi(line));
    }
  }

  return output.join("\n");
}
