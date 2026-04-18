import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import type { CritterTypeConfig, PhaseConfig } from "./critter-type.js";
import {
  buildPromptVars,
  getBuiltinPhaseName,
  isBuiltinPhase,
  resolvePrompt,
  resolveSkills,
  resolveTools,
} from "./prompt-template.js";
import { loadRepoConfig } from "./repo-config.js";
import type { TrackerTask } from "./tracker/types.js";

function loadEnv(): void {
  const cwdEnv = "./.env";
  const userEnv = `${homedir()}/.critters/.env`;
  if (!existsSync(cwdEnv) && existsSync(userEnv)) {
    const envContent = readFileSync(userEnv, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

function stubTask(overrides: Partial<TrackerTask>): TrackerTask {
  return {
    id: "stub-issue-id",
    identifier: "STUB-123",
    title: "Example issue title",
    description: "Stub description for prompt rendering. Replace with real values via --title / --description.",
    repoUrl: "git@github.com:you/your-repo.git",
    group: "engineering",
    groupId: "stub-team-id",
    projectId: undefined,
    labels: [],
    baseBranch: "main",
    ...overrides,
  };
}

function printHelp(): void {
  console.log(`Usage: critters prompt render <type> <phase> [flags]

Renders a phase prompt exactly as the runner would see it: file contents +
{{variable}} substitution + concatenated skills + resolved tool list.

Flags:
  --identifier <ID>     Override the stub issue identifier (e.g. ACK-123)
  --title <text>        Override the stub issue title
  --description <text>  Override the stub issue description
  --repo <url>          Override the stub repoUrl
  --branch <name>       Override the branch name (default: critter/<identifier>)
  --work-dir <path>     Override the workDir substituted into {{workDir}}
  --json                Output as JSON (prompt + skills + tools + vars)
  --config <path>       Use a custom config file

Examples:
  critters prompt render create planning
  critters prompt render create execution --identifier ACK-42 --json
  critters prompt render my-custom-type review --title "Ship the thing"`);
}

function findPhase(
  types: CritterTypeConfig[],
  typeName: string,
  phaseName: string,
): { type: CritterTypeConfig; phase: PhaseConfig } {
  const type = types.find((t) => t.name === typeName);
  if (!type) {
    const available = types.map((t) => t.name).join(", ");
    throw new Error(`critter type '${typeName}' not found. Available: ${available}`);
  }
  const phase = type.phases.find((p) => p.name === phaseName);
  if (!phase) {
    const available = type.phases.map((p) => p.name).join(", ");
    throw new Error(`phase '${phaseName}' not found on type '${typeName}'. Available: ${available}`);
  }
  return { type, phase };
}

function section(title: string, body: string): void {
  const bar = "─".repeat(Math.max(0, 72 - title.length - 2));
  console.log(`\n── ${title} ${bar}`);
  console.log(body);
}

function truncate(s: string, max = 120): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export async function runPromptRender(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h") || argv.length < 2) {
    printHelp();
    process.exit(argv.length < 2 ? 1 : 0);
  }

  loadEnv();

  const [typeName, phaseName] = argv;
  const configPath = flag(argv, "--config");
  const asJson = argv.includes("--json");

  const identifier = flag(argv, "--identifier") ?? "STUB-123";
  const title = flag(argv, "--title");
  const description = flag(argv, "--description");
  const repoUrl = flag(argv, "--repo");
  const branch = flag(argv, "--branch") ?? `critter/${identifier}`;
  const workDir = flag(argv, "--work-dir") ?? "/tmp/critters-render";

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    console.error(`Error loading config: ${(err as Error).message}`);
    process.exit(1);
  }

  let phase: PhaseConfig;
  try {
    ({ phase } = findPhase(config.critterTypes, typeName, phaseName));
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  const task = stubTask({
    identifier,
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(repoUrl !== undefined && { repoUrl }),
  });

  const vars = buildPromptVars(task, workDir, branch);
  const repoConfig = loadRepoConfig(workDir);

  let promptBody: string | null;
  let skillsBody: string;
  let tools: string[];
  try {
    promptBody = resolvePrompt(phase.prompt, vars);
    skillsBody = resolveSkills(phase.skills, vars);
    tools = resolveTools(phase.tools, config, task, repoConfig);
  } catch (err) {
    console.error(`Error resolving prompt: ${(err as Error).message}`);
    process.exit(1);
  }

  const builtinName = isBuiltinPhase(phase) ? getBuiltinPhaseName(phase) : null;

  if (asJson) {
    console.log(JSON.stringify({
      type: typeName,
      phase: phase.name,
      model: phase.model,
      maxTurns: phase.maxTurns,
      builtin: builtinName,
      prompt: promptBody,
      skills: skillsBody || null,
      tools,
      vars,
    }, null, 2));
    return;
  }

  section("PHASE", `  type=${typeName}  phase=${phase.name}  model=${phase.model}  maxTurns=${phase.maxTurns}`);

  section("VARS", Object.entries(vars)
    .map(([k, v]) => `  ${k.padEnd(12)} = ${truncate(v)}`)
    .join("\n"));

  section("TOOLS", tools.length === 0
    ? "  (none)"
    : tools.map((t) => `  ${t}`).join("\n"));

  if (builtinName !== null) {
    section("PROMPT", `  <builtin:${builtinName}> — constructed in code by the ${builtinName} runner.\n  Rendering builtins isn't supported; edit a custom prompt file to preview.`);
  } else {
    section("PROMPT", promptBody ?? "  (empty)");
  }

  if (skillsBody) {
    section("SKILLS", skillsBody.trimStart());
  } else if (phase.skills && phase.skills.length > 0) {
    section("SKILLS", "  (configured but produced no content)");
  }

  console.log();
}
