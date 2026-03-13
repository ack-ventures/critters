import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PhaseConfig } from "./critter-type.js";
import {
  getExecutionAllowedTools,
  getPlanningAllowedTools,
} from "./prompt.js";
import type { PerRepoConfig } from "./repo-config.js";
import { getReviewAllowedTools } from "./review-prompt.js";
import type { TrackerTask } from "./tracker/types.js";
import type { Config } from "./types.js";

/**
 * Resolve a prompt reference to actual prompt text.
 * - "builtin:*" prompts return null (handled by built-in runners)
 * - File paths load the file and apply variable substitution
 */
export function resolvePrompt(
  promptRef: string,
  vars: Record<string, string>,
): string | null {
  if (promptRef.startsWith("builtin:")) {
    return null;
  }

  // Expand ~ to homedir
  const filePath = promptRef.startsWith("~")
    ? join(homedir(), promptRef.slice(1))
    : promptRef;

  if (!existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath}`);
  }

  let content = readFileSync(filePath, "utf-8");

  // Apply {{var}} substitution
  for (const [key, value] of Object.entries(vars)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return content;
}

/**
 * Build prompt variables from a task context.
 */
export function buildPromptVars(
  task: TrackerTask,
  workDir: string,
  branch: string,
): Record<string, string> {
  return {
    identifier: task.identifier,
    title: task.title,
    description: task.description,
    branch,
    baseBranch: task.baseBranch ?? "",
    repoUrl: task.repoUrl,
    workDir,
    group: task.group,
    groupId: task.groupId,
  };
}

/**
 * Resolve a tools specification to an actual tools list.
 * - "readonly": planning-phase read-only tools
 * - "default": execution-phase tools (config defaults + per-project/repo extras)
 * - "review": review-phase tools
 * - string[]: pass through as-is, merging with repo config extras
 */
export function resolveTools(
  toolsSpec: string | string[],
  config: Config,
  task: TrackerTask,
  repoConfig: PerRepoConfig | null,
): string[] {
  if (typeof toolsSpec === "string") {
    switch (toolsSpec) {
      case "readonly":
        return getPlanningAllowedTools();
      case "default":
        return getExecutionAllowedTools(
          config,
          // Adapt TrackerTask to the CritterTask shape expected by getExecutionAllowedTools
          { issueId: task.id, identifier: task.identifier, title: task.title, description: task.description, repoUrl: task.repoUrl, teamId: task.groupId, projectId: task.projectId },
          repoConfig,
        );
      case "review":
        return getReviewAllowedTools();
      default:
        throw new Error(`Unknown tools preset: ${toolsSpec}`);
    }
  }

  // Explicit tool list — merge with repo config extras
  const tools = [...toolsSpec];
  if (repoConfig?.extraAllowedTools) {
    tools.push(...repoConfig.extraAllowedTools);
  }
  return [...new Set(tools)];
}

/**
 * Resolve skill files and return concatenated content with separators.
 */
export function resolveSkills(
  skills: string[] | undefined,
  vars: Record<string, string>,
): string {
  if (!skills || skills.length === 0) return "";

  const parts: string[] = [];
  for (const skillRef of skills) {
    const filePath = skillRef.startsWith("~")
      ? join(homedir(), skillRef.slice(1))
      : skillRef;

    if (!existsSync(filePath)) {
      throw new Error(`Skill file not found: ${filePath}`);
    }

    let content = readFileSync(filePath, "utf-8");

    // Apply {{var}} substitution
    for (const [key, value] of Object.entries(vars)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    const skillName = basename(filePath).replace(/\.[^.]+$/, "");
    parts.push(`---\n\n## Skill: ${skillName}\n\n${content.trim()}`);
  }

  return "\n\n" + parts.join("\n\n");
}

/**
 * Check if a phase uses a built-in prompt.
 */
export function isBuiltinPhase(phase: PhaseConfig): boolean {
  return phase.prompt.startsWith("builtin:");
}

/**
 * Get the builtin phase name from a prompt reference.
 */
export function getBuiltinPhaseName(phase: PhaseConfig): string | null {
  if (!phase.prompt.startsWith("builtin:")) return null;
  return phase.prompt.slice("builtin:".length);
}
