import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliAdapter } from "./cli/types.js";
import type { PerRepoConfig } from "./repo-config.js";
import type { Config, CritterTask } from "./types.js";
import { sanitizeIdentifier } from "./utils.js";

const REPO_LINE_RE = /^repo:\s*(.+)$/mi;
const BRANCH_LINE_RE = /^branch:\s*(.+)$/mi;

export function readCustomPrompt(filename: string, baseDir?: string): string | null {
  const dir = baseDir ?? join(homedir(), ".critters");
  const filePath = join(dir, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  if (content.trim() === "") return null;
  return content.trim();
}

export function cleanLinearMarkdown(text: string): string {
  // Linear converts git@github.com into [git@github.com](<mailto:git@github.com>)
  // Undo that so we get the raw SSH URL back
  return text.replace(/\[([^\]]+)\]\(<mailto:[^>]+>\)/g, "$1");
}

/**
 * Clean a description based on the provider format.
 * Linear uses markdown with mailto wrapping; Jira descriptions come as
 * pre-cleaned plain text from the tracker (ADF → text conversion happens there).
 */
export function cleanDescription(text: string, provider?: string): string {
  if (provider === "jira") return text;
  return cleanLinearMarkdown(text);
}

export function parseRepoUrl(description: string, provider?: string): string | null {
  const cleaned = cleanDescription(description, provider);
  const match = cleaned.match(REPO_LINE_RE);
  return match ? match[1].trim() : null;
}

export function stripRepoLine(description: string, provider?: string): string {
  const cleaned = cleanDescription(description, provider);
  return cleaned.replace(REPO_LINE_RE, "").trim();
}

export function parseBaseBranch(description: string, provider?: string): string | null {
  const cleaned = cleanDescription(description, provider);
  const match = cleaned.match(BRANCH_LINE_RE);
  return match ? match[1].trim() : null;
}

export function stripBranchLine(description: string, provider?: string): string {
  const cleaned = cleanDescription(description, provider);
  return cleaned.replace(BRANCH_LINE_RE, "").trim();
}

export function resolveRepoUrlWithSource(
  task: CritterTask,
  config: Config,
): { url: string; source: string } | null {
  const fromDescription = parseRepoUrl(task.description);
  if (fromDescription) return { url: fromDescription, source: "from description" };

  if (task.projectId && config.repos[task.projectId]) {
    return { url: config.repos[task.projectId].url, source: "from project config" };
  }

  if (config.teamRepos[task.teamId]) {
    return { url: config.teamRepos[task.teamId], source: "from team config" };
  }

  if (config.defaultRepo) {
    return { url: config.defaultRepo, source: "from defaultRepo config" };
  }

  return null;
}

export function resolveRepoUrl(task: CritterTask, config: Config): string | null {
  const result = resolveRepoUrlWithSource(task, config);
  return result ? result.url : null;
}

export function getPlanningAllowedTools(): string[] {
  return [
    "Read", "Glob", "Grep", "Task", "Write",
    "Bash(git:*)", "Bash(ls:*)", "Bash(cat:*)",
    "Bash(npm:*)", "Bash(node:*)",
  ];
}

export function getExecutionAllowedTools(config: Config, task: CritterTask, repoConfig?: PerRepoConfig | null): string[] {
  const tools = [...config.defaults.defaultAllowedTools];

  // Merge per-project extra tools from daemon config
  if (task.projectId && config.repos[task.projectId]?.extraAllowedTools) {
    const extra = config.repos[task.projectId]?.extraAllowedTools;
    if (extra) {
      tools.push(...extra);
    }
  }

  // Merge per-repo extra tools from .critters.yaml
  if (repoConfig?.extraAllowedTools) {
    tools.push(...repoConfig.extraAllowedTools);
  }

  return [...new Set(tools)];
}

function buildToolRestrictionGuidance(
  bashCommands: string[],
  adapter?: CliAdapter,
): string {
  const commandList = bashCommands.join(", ");
  if (adapter?.capabilities.toolRestrictions === false) {
    return `## Tool Restrictions
Requested command policy: stay within these commands unless the task cannot proceed: ${commandList}.
The active CLI cannot enforce the full Critters allowlist mechanically, so treat this as a hard workflow rule and rely on the sandbox for the actual execution boundary.
If a command is blocked or requires approval, do NOT retry it repeatedly — move on and find an alternative approach or skip that step.`;
  }

  return `## Tool Restrictions
You have a limited set of tools. Only these Bash commands are available: ${commandList}.
If a command is blocked or requires approval, do NOT retry it — move on and find an alternative approach or skip that step.`;
}

export function buildPlanningPrompt(task: CritterTask, adapter?: CliAdapter, repoConfig?: PerRepoConfig | null): string {
  const cleanedDescription = stripBranchLine(stripRepoLine(task.description));
  // Sanitized: identifiers like "owner/repo#42" must not become nested paths.
  const planFile = `critters/plans/${sanitizeIdentifier(task.identifier)}.md`;

  const tools = adapter?.toolNames() ?? { read: "Read", write: "Write", edit: "Edit", bash: "Bash", glob: "Glob", grep: "Grep", task: "Task" };
  const hasSubagents = adapter?.capabilities.subagents ?? true;

  let reviewerSteps: string;
  if (hasSubagents && tools.task) {
    reviewerSteps = `4. Spawn a reviewer subagent using the ${tools.task} tool with this prompt:
   "Review the implementation plan in ${planFile} for the task: ${task.title}. Read the plan and the relevant source files it references. Check for: completeness, correctness, potential issues, missing edge cases, and whether it aligns with the codebase's patterns.

   Output your review in this exact format:

   REVIEW_STATUS: APPROVED

   OR:

   REVIEW_STATUS: NEEDS_REVISION

   ## Issues Found
   - [MUST_FIX] <description>
   - [SHOULD_FIX] <description>
   - [CONSIDER] <description>

   Severity levels:
   - MUST_FIX: Blocks approval. Correctness issues, missing requirements, security problems, or architectural mistakes that must be addressed.
   - SHOULD_FIX: Should be addressed but won't block approval alone. Code quality, pattern consistency, or minor gaps.
   - CONSIDER: Suggestions for improvement. Won't block approval.

   Approval requires zero MUST_FIX items. SHOULD_FIX items alone do not block approval but should be noted.

   If this is a re-review (round 2+), you will see a '## Previous Review Items' section in the plan. Verify that all prior MUST_FIX items have been adequately addressed. If a prior MUST_FIX was not addressed, re-list it as MUST_FIX with a note that it is unresolved from a prior round."
5. If the reviewer output contains REVIEW_STATUS: NEEDS_REVISION, revise your plan (use the ${tools.write} tool to rewrite the entire plan file — ${tools.edit} is not available):
   a. Add a "## Previous Review Items" section at the end of the plan file
   b. For each MUST_FIX and SHOULD_FIX item from the reviewer, quote the item and explain how you addressed it (or why you chose not to address a SHOULD_FIX). Format:
      > [MUST_FIX] <original item>
      Addressed: <explanation of what changed>
   c. Update the relevant sections of the plan to incorporate the fixes
   d. Spawn another reviewer subagent with the same prompt
6. Repeat until the reviewer responds with REVIEW_STATUS: APPROVED (max 3 review rounds — if not approved after 3, stop and exit with an error)
7. Once approved, you are done — do not implement anything`;
  } else {
    reviewerSteps = `4. Once your plan is complete and thorough, you are done — do not implement anything`;
  }

  let prompt = `You are working on issue ${task.identifier}: ${task.title}

## Task
${cleanedDescription}

## Your Workflow
1. Explore the codebase thoroughly — understand the project structure, patterns, and conventions
2. Design an implementation plan for this task
3. Write your plan to ${planFile} (the directory already exists — do not create it)
${reviewerSteps}

## Plan Format
Your plan should include:
- Summary of what changes are needed
- Files to create/modify with specific descriptions of changes
- Any dependencies or setup needed
- Testing approach

${buildToolRestrictionGuidance(["git", "ls", "cat", "npm", "node"], adapter)}
Never run \`bun run src/index.ts\`, \`bun start\`, or any command that starts the critters daemon — it will destroy your working directory.

${adapter?.promptGuidance() ?? "## Reading Large Files\nThe Read tool supports `offset` and `limit` parameters \u2014 use these to read large files in chunks rather than attempting to read the entire file at once."}`;

  const custom = readCustomPrompt("planning-prompt.md");
  if (custom) {
    prompt += `\n\n## Additional Context\n${custom}`;
  }

  if (repoConfig?.planningPrompt) {
    prompt += `\n\n## Repo-Specific Instructions\n${repoConfig.planningPrompt.trim()}`;
  }

  return prompt;
}

function getOsGuidance(): string {
  if (process.platform === "darwin") {
    return "You are running on macOS — some GNU-specific flags (like `cat -A`, `grep -P`) are not available.";
  }
  return "You are running on Linux.";
}

export function buildExecutionPrompt(task: CritterTask, allowedTools: string[], options?: { resuming?: boolean; repoConfig?: PerRepoConfig | null; commitPlans?: boolean; defaultBranch?: string; cliAdapter?: CliAdapter }): string {
  const bashTools = allowedTools
    .filter((t) => t.startsWith("Bash("))
    .map((t) => t.replace(/^Bash\(([^:]+):.*\)$/, "$1"));

  const resuming = options?.resuming ?? false;
  const adapter = options?.cliAdapter;
  const guidance = adapter?.promptGuidance();
  // Sanitized: identifiers like "owner/repo#42" must not become nested paths.
  const planFile = `critters/plans/${sanitizeIdentifier(task.identifier)}.md`;
  const checkpointFile = `critters/plans/${sanitizeIdentifier(task.identifier)}.checkpoint.md`;

  const resumePreamble = resuming
    ? `## Resuming from checkpoint
This is a RETRY of a previously failed attempt. A checkpoint file exists at \`${checkpointFile}\`.
Read it first to see which steps were already completed. Skip completed steps and continue from where the previous attempt left off.
Review the existing code changes on this branch to confirm the completed steps are actually done before skipping them.

`
    : "";

  const planInstruction = resuming
    ? `Continue executing the plan from where the previous attempt stopped.`
    : `Execute the plan completely.`;

  let prompt = `${resumePreamble}You are working on issue ${task.identifier}: ${task.title}

Read ${planFile} — it contains an approved implementation plan.
${planInstruction} Then:
- Commit your changes with a message referencing ${task.identifier}
- Push your branch
- Create a PR using \`gh pr create --head <branch-name> --base ${options?.defaultBranch ?? "<default-branch>"}\` with title "[${task.identifier}] ${task.title}" and body that includes a link to ${task.issueUrl ? `the issue (${task.issueUrl})` : "the issue tracker ticket"} and "Automated by Critters". Always use both the --head and --base flags.${!options?.defaultBranch ? " Determine the default branch with: git rev-parse --abbrev-ref origin/HEAD" : ""}

${guidance ?? `## Editing Files
- Always read a file before editing it. Pay attention to whether it uses tabs or spaces for indentation \u2014 the Read tool's line numbers can make tabs look like spaces.
- Do not fire more than 3\u20114 Edit calls in parallel. If one fails, all sibling parallel edits are cancelled too.

## Reading Large Files
The Read tool supports \`offset\` and \`limit\` parameters \u2014 use these to read large files in chunks rather than attempting to read the entire file at once.`}

## Checkpointing
After completing each major section/step of the plan, update a checkpoint file at \`${checkpointFile}\`.
The file should be a checklist mirroring the plan's sections, e.g.:
\`\`\`
- [x] Step 1: Set up the retry utility
- [x] Step 2: Migrate git.ts
- [ ] Step 3: Migrate spawner.ts
- [ ] Step 4: Add tests
\`\`\`
${(options?.commitPlans ?? false) ? "Commit the checkpoint file alongside your code changes (include it in the same commit, not separately)." : "Do NOT commit files under `critters/` — they are internal working files, not part of the target repo."}

${buildToolRestrictionGuidance(bashTools, adapter)}
Commands like chmod, bunx, perl, python3, curl, and others are outside the requested policy.
Use "bun x" instead of "bunx" to run package binaries.
${getOsGuidance()}
Never retry a blocked command more than once.

## Important: Do NOT run the project entry point
Never run \`bun run src/index.ts\`, \`bun start\`, or any command that starts the critters daemon. This will launch a second daemon instance that cleans up work directories — including yours — and destroy your in-progress work. Use \`bun x tsc --noEmit\` for type-checking instead.`;

  const custom = readCustomPrompt("execution-prompt.md");
  if (custom) {
    prompt += `\n\n## Additional Context\n${custom}`;
  }

  if (options?.repoConfig?.executionPrompt) {
    prompt += `\n\n## Repo-Specific Instructions\n${options.repoConfig.executionPrompt.trim()}`;
  }

  return prompt;
}
