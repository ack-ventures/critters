import type { CliAdapter } from "./cli/types.js";
import { readCustomPrompt, stripBranchLine, stripRepoLine } from "./prompt.js";
import type { PerRepoConfig } from "./repo-config.js";
import type { ReviewTask } from "./types.js";

export function getReviewAllowedTools(): string[] {
  return [
    "Read", "Glob", "Grep",
    "Bash(gh:*)", "Bash(git:*)", "Bash(ls:*)", "Bash(cat:*)",
  ];
}

export function buildReviewPrompt(task: ReviewTask, adapter?: CliAdapter | PerRepoConfig | null, repoConfig?: PerRepoConfig | null): string {
  // Support old signature: buildReviewPrompt(task, repoConfig)
  let actualAdapter: CliAdapter | undefined;
  let actualRepoConfig: PerRepoConfig | null | undefined;
  if (adapter && typeof adapter === "object" && "name" in adapter && "binary" in adapter) {
    actualAdapter = adapter as CliAdapter;
    actualRepoConfig = repoConfig;
  } else {
    actualAdapter = undefined;
    actualRepoConfig = adapter as PerRepoConfig | null | undefined;
  }

  const cleanedDescription = stripBranchLine(stripRepoLine(task.description));
  const readingGuidance = actualAdapter?.promptGuidance() ?? "## Reading Large Files\nThe Read tool supports `offset` and `limit` parameters \u2014 use these to read large files in chunks rather than attempting to read the entire file at once.";

  let prompt = `You are reviewing a pull request for issue ${task.identifier}: ${task.title}

## PR
- URL: ${task.prUrl}
- Branch: ${task.prBranch}

## Original Task
${cleanedDescription}

## Your Workflow

### Step 1: Understand the changes
1. Run \`gh pr view ${task.prNumber} --json title,body,additions,deletions,changedFiles\` for PR metadata
2. Run \`gh pr diff ${task.prNumber}\` to read the full diff
3. Read full files where you need more context beyond the diff (the PR branch is already checked out)

### Step 2: Review the implementation
Compare the PR against the original task description above. Check:
- **Task match**: Does the implementation actually address what was requested? Are any requirements missed?
- **Correctness**: Logic errors, off-by-one, null handling, race conditions?
- **Patterns & conventions**: Does the code follow the existing codebase's style and architecture?
- **Security**: Hardcoded secrets, injection risks, unsafe input handling?
- **Tests**: Are new/changed behaviors covered by tests?
- **Edge cases**: Error paths and boundary conditions handled?

### Step 3: Wait for CI and merge (if approved)

**If the PR looks good** (no significant issues):
1. Run: \`gh pr review ${task.prNumber} --approve -b "LGTM. Automated review by Critters."\`
2. Check CI status: \`gh pr checks ${task.prNumber}\`
   - If all checks have already passed → skip to merge
   - If any check has failed → skip to the CI-failed path below
   - If checks are pending or no checks exist yet → continue to step 3
3. Wait for CI using: \`gh pr checks ${task.prNumber} --watch --fail-fast\`
   - This command blocks until checks complete. It may take several minutes — this is expected.
   - If the command exits 0 → checks passed, proceed to merge
   - If the command exits non-zero → checks failed, go to CI-failed path
   - If the command appears to hang or you get a timeout error → run \`gh pr checks ${task.prNumber}\` one final time to snapshot the current state, then output: REVIEW_RESULT:NEEDS_CHANGES:CI timed out — checks still pending after extended wait
4. Merge: \`gh pr merge ${task.prNumber} --squash --delete-branch\`
   - If merge fails → output: REVIEW_RESULT:NEEDS_CHANGES:Merge failed
5. After successful merge → output: REVIEW_RESULT:MERGED

**CI-failed path:**
1. Run \`gh pr checks ${task.prNumber}\` to capture which checks failed
2. Run: \`gh pr review ${task.prNumber} --request-changes -b "CI checks failed: <list failed check names>"\`
3. Output: REVIEW_RESULT:NEEDS_CHANGES:CI checks failed

**If the PR needs changes** (real issues, not just style nits):
1. Write clear, actionable feedback explaining what needs to change and why
2. Run: \`gh pr review ${task.prNumber} --request-changes -b "<your feedback>"\`
3. Output: REVIEW_RESULT:NEEDS_CHANGES:<one-line summary>

## Rules
- You MUST output exactly one REVIEW_RESULT line as the very last thing you write
- Format: REVIEW_RESULT:MERGED or REVIEW_RESULT:NEEDS_CHANGES:<reason>
- Do NOT modify any files or create commits — you are a reviewer only
- Be pragmatic: minor style nits or trivial improvements should NOT block a merge. Only request changes for genuine correctness, security, or completeness issues.
- If the PR is mostly good with a minor issue, approve it with a note rather than requesting changes.

${readingGuidance}`;

  const custom = readCustomPrompt("review-prompt.md");
  if (custom) {
    prompt += `\n\n## Additional Context\n${custom}`;
  }

  if (actualRepoConfig?.reviewPrompt) {
    prompt += `\n\n## Repo-Specific Instructions\n${actualRepoConfig.reviewPrompt.trim()}`;
  }

  return prompt;
}
