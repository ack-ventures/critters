import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, CritterTask } from "./types.js";

const REPO_LINE_RE = /^repo:\s*(.+)$/mi;

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

export function parseRepoUrl(description: string): string | null {
  const cleaned = cleanLinearMarkdown(description);
  const match = cleaned.match(REPO_LINE_RE);
  return match ? match[1].trim() : null;
}

export function stripRepoLine(description: string): string {
  const cleaned = cleanLinearMarkdown(description);
  return cleaned.replace(REPO_LINE_RE, "").trim();
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

export function getExecutionAllowedTools(config: Config, task: CritterTask): string[] {
  const tools = [...config.defaultAllowedTools];

  // Merge per-repo extra tools
  if (task.projectId && config.repos[task.projectId]?.extraAllowedTools) {
    const extra = config.repos[task.projectId]?.extraAllowedTools;
    if (extra) {
      tools.push(...extra);
    }
  }

  return [...new Set(tools)];
}

export function buildPlanningPrompt(task: CritterTask): string {
  const cleanedDescription = stripRepoLine(task.description);

  let prompt = `You are working on issue ${task.identifier}: ${task.title}

## Task
${cleanedDescription}

## Your Workflow
1. Explore the codebase thoroughly — understand the project structure, patterns, and conventions
2. Design an implementation plan for this task
3. Write your plan to critters/plans/${task.identifier}.md (the directory already exists — do not create it)
4. Spawn a reviewer subagent using the Task tool with this prompt:
   "Review the implementation plan in critters/plans/${task.identifier}.md for the task: ${task.title}. Read the plan and the relevant source files it references. Check for: completeness, correctness, potential issues, missing edge cases, and whether it aligns with the codebase's patterns.

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
5. If the reviewer output contains REVIEW_STATUS: NEEDS_REVISION, revise your plan:
   a. Add a "## Previous Review Items" section at the end of the plan file
   b. For each MUST_FIX and SHOULD_FIX item from the reviewer, quote the item and explain how you addressed it (or why you chose not to address a SHOULD_FIX). Format:
      > [MUST_FIX] <original item>
      Addressed: <explanation of what changed>
   c. Update the relevant sections of the plan to incorporate the fixes
   d. Spawn another reviewer subagent with the same prompt
6. Repeat until the reviewer responds with REVIEW_STATUS: APPROVED (max 3 review rounds — if not approved after 3, stop and exit with an error)
7. Once approved, you are done — do not implement anything

## Plan Format
Your plan should include:
- Summary of what changes are needed
- Files to create/modify with specific descriptions of changes
- Any dependencies or setup needed
- Testing approach

## Tool Restrictions
You have a limited set of tools. Only these Bash commands are available: git, ls, cat, npm, node.
If a command is blocked or requires approval, do NOT retry it — move on and find an alternative approach or skip that step.`;

  const custom = readCustomPrompt("planning-prompt.md");
  if (custom) {
    prompt += `\n\n## Additional Context\n${custom}`;
  }

  return prompt;
}

function getOsGuidance(): string {
  if (process.platform === "darwin") {
    return "You are running on macOS — some GNU-specific flags (like `cat -A`, `grep -P`) are not available.";
  }
  return "You are running on Linux.";
}

export function buildExecutionPrompt(task: CritterTask, allowedTools: string[], options?: { resuming?: boolean }): string {
  const bashTools = allowedTools
    .filter((t) => t.startsWith("Bash("))
    .map((t) => t.replace(/^Bash\(([^:]+):.*\)$/, "$1"));

  const resuming = options?.resuming ?? false;

  const resumePreamble = resuming
    ? `## Resuming from checkpoint
This is a RETRY of a previously failed attempt. A checkpoint file exists at \`critters/plans/${task.identifier}.checkpoint.md\`.
Read it first to see which steps were already completed. Skip completed steps and continue from where the previous attempt left off.
Review the existing code changes on this branch to confirm the completed steps are actually done before skipping them.

`
    : "";

  const planInstruction = resuming
    ? `Continue executing the plan from where the previous attempt stopped.`
    : `Execute the plan completely.`;

  let prompt = `${resumePreamble}You are working on issue ${task.identifier}: ${task.title}

Read critters/plans/${task.identifier}.md — it contains an approved implementation plan.
${planInstruction} Then:
- Commit your changes with a message referencing ${task.identifier}
- Push your branch
- Create a PR using \`gh pr create --head <branch-name>\` with title "[${task.identifier}] ${task.title}" and body that includes a link to the Linear issue and "Automated by Critters". Always use the --head flag.

## Editing Files
- Always read a file before editing it. Pay attention to whether it uses tabs or spaces for indentation — the Read tool's line numbers can make tabs look like spaces.
- Do not fire more than 3-4 Edit calls in parallel. If one fails, all sibling parallel edits are cancelled too.

## Checkpointing
After completing each major section/step of the plan, update a checkpoint file at \`critters/plans/${task.identifier}.checkpoint.md\`.
The file should be a checklist mirroring the plan's sections, e.g.:
\`\`\`
- [x] Step 1: Set up the retry utility
- [x] Step 2: Migrate git.ts
- [ ] Step 3: Migrate spawner.ts
- [ ] Step 4: Add tests
\`\`\`
Commit the checkpoint file alongside your code changes (include it in the same commit, not separately).

## Tool Restrictions
You have a limited set of tools. Only these Bash commands are available: ${bashTools.join(", ")}.
Commands like chmod, bunx, perl, python3, curl, and others are NOT available.
Use "bun x" instead of "bunx" to run package binaries.
${getOsGuidance()}
If a command is blocked or requires approval, do NOT retry it — move on and find an alternative approach or skip that step. Never retry a blocked command more than once.`;

  const custom = readCustomPrompt("execution-prompt.md");
  if (custom) {
    prompt += `\n\n## Additional Context\n${custom}`;
  }

  return prompt;
}
