import type { Config, CritterTask } from "./types.js";

const REPO_LINE_RE = /^repo:\s*(.+)$/mi;

export function parseRepoUrl(description: string): string | null {
  const match = description.match(REPO_LINE_RE);
  return match ? match[1].trim() : null;
}

export function stripRepoLine(description: string): string {
  return description.replace(REPO_LINE_RE, "").trim();
}

export function resolveRepoUrl(task: CritterTask, config: Config): string | null {
  // 1. Check description for repo: line
  const fromDescription = parseRepoUrl(task.description);
  if (fromDescription) return fromDescription;

  // 2. Check project config
  if (task.projectId && config.repos[task.projectId]) {
    return config.repos[task.projectId].url;
  }

  // 3. Check team config
  if (config.teamRepos[task.teamId]) {
    return config.teamRepos[task.teamId];
  }

  return null;
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
    tools.push(...config.repos[task.projectId].extraAllowedTools!);
  }

  return [...new Set(tools)];
}

export function buildPlanningPrompt(task: CritterTask): string {
  const cleanedDescription = stripRepoLine(task.description);

  return `You are working on issue ${task.identifier}: ${task.title}

## Task
${cleanedDescription}

## Your Workflow
1. Explore the codebase thoroughly — understand the project structure, patterns, and conventions
2. Design an implementation plan for this task
3. Write your plan to critters/plans/${task.identifier}.md
4. Spawn a reviewer subagent using the Task tool with this prompt:
   "Review the implementation plan in critters/plans/${task.identifier}.md for the task: ${task.title}. Read the plan and the relevant source files it references. Check for: completeness, correctness, potential issues, missing edge cases, and whether it aligns with the codebase's patterns. If the plan is solid, respond with exactly 'APPROVED'. Otherwise, provide specific actionable feedback."
5. If the reviewer provides feedback (not APPROVED), revise the plan file and spawn another reviewer
6. Repeat until the reviewer responds with APPROVED (max 3 review rounds — if not approved after 3, stop and exit with an error)
7. Once approved, you are done — do not implement anything

## Plan Format
Your plan should include:
- Summary of what changes are needed
- Files to create/modify with specific descriptions of changes
- Any dependencies or setup needed
- Testing approach`;
}

export function buildExecutionPrompt(task: CritterTask): string {
  return `You are working on issue ${task.identifier}: ${task.title}

Read critters/plans/${task.identifier}.md — it contains an approved implementation plan.
Execute the plan completely. Then:
- Commit your changes with a message referencing ${task.identifier}
- Push your branch
- Create a draft PR with title "[${task.identifier}] ${task.title}" and body that includes a link to the Linear issue and "Automated by Critters"`;
}
