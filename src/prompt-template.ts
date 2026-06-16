import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PhaseConfig } from "./critter-type.js";
import { ToolPreset } from "./enums.js";
import { logWarn } from "./logger.js";
import {
  getExecutionAllowedTools,
  getPlanningAllowedTools,
  stripBranchLine,
  stripRepoLine,
} from "./prompt.js";
import type { PerRepoConfig } from "./repo-config.js";
import { getReviewAllowedTools } from "./review-prompt.js";
import type { TrackerTask } from "./tracker/types.js";
import type { Config } from "./types.js";

/**
 * Single-pass {{var}} substitution.
 *
 * Each `{{token}}` is replaced at most once in one scan, so:
 * - a value that itself contains another variable's `{{token}}` cannot be
 *   re-substituted on a subsequent pass (B15), and
 * - replacement values are inserted literally — special replacement patterns
 *   like `$&`, `` $` ``, `$'`, `$$` in untrusted issue text are NOT interpreted
 *   (B10), because we use a replacer function rather than string replacement.
 *
 * Unknown tokens are left intact and reported separately (F7).
 *
 * Unknown tokens are detected DURING this single scan — only `{{token}}`s for
 * which no variable exists are collected. A `{{token}}` that appears because it
 * was part of an inserted replacement value is never re-scanned, so it cannot
 * be mistaken for an unresolved token (avoids the B15 false positive).
 */
function substitute(
  content: string,
  vars: Record<string, string>,
): { result: string; unknownTokens: string[] } {
  const unknown = new Set<string>();
  const result = content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (Object.hasOwn(vars, key)) {
      return vars[key];
    }
    unknown.add(match);
    return match;
  });
  return { result, unknownTokens: [...unknown] };
}

/**
 * Warn (without throwing) about any unknown `{{token}}` found during
 * substitution — typically a typo or an undefined variable (F7).
 */
function warnUnknownTokens(tokens: string[], source: string): void {
  if (tokens.length > 0) {
    logWarn(
      `Unresolved template token(s) in ${source}: ${tokens.join(", ")} — left intact`,
    );
  }
}

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

  const { result, unknownTokens } = substitute(
    readFileSync(filePath, "utf-8"),
    vars,
  );
  warnUnknownTokens(unknownTokens, `prompt file ${basename(filePath)}`);
  return result;
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
    // Clean {{description}} the same way builtin planning/review do, stripping
    // the repo/branch directive lines (B16). These vars feed every prompt path
    // — builtin skills, custom prompts, and cli-prompt-render — so all of them
    // see the cleaned text. The raw, unmodified description is still available
    // via {{descriptionRaw}}.
    description: stripBranchLine(stripRepoLine(task.description)),
    descriptionRaw: task.description,
    branch,
    baseBranch: task.baseBranch ?? "",
    repoUrl: task.repoUrl,
    workDir,
    group: task.group,
    groupId: task.groupId,
    prUrl: task.prUrl ?? "",
    prNumber: task.prNumber != null ? String(task.prNumber) : "",
    prBranch: task.prBranch ?? "",
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
      case ToolPreset.Readonly:
        return getPlanningAllowedTools();
      case ToolPreset.Default:
        return getExecutionAllowedTools(
          config,
          // Adapt TrackerTask to the CritterTask shape expected by getExecutionAllowedTools
          { issueId: task.id, identifier: task.identifier, title: task.title, description: task.description, repoUrl: task.repoUrl, teamId: task.groupId, projectId: task.projectId },
          repoConfig,
        );
      case ToolPreset.Review:
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

    const { result, unknownTokens } = substitute(
      readFileSync(filePath, "utf-8"),
      vars,
    );
    warnUnknownTokens(unknownTokens, `skill file ${basename(filePath)}`);

    const skillName = basename(filePath).replace(/\.[^.]+$/, "");
    parts.push(`---\n\n## Skill: ${skillName}\n\n${result.trim()}`);
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
