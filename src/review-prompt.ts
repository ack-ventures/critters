import { readCustomPrompt, stripRepoLine } from "./prompt.js";
import type { PerRepoConfig } from "./repo-config.js";
import type { ReviewTask } from "./types.js";

export function getReviewAllowedTools(): string[] {
  return [
    "Read", "Glob", "Grep",
    "Bash(gh:*)", "Bash(git:*)", "Bash(ls:*)", "Bash(cat:*)",
  ];
}

export function buildReviewPrompt(task: ReviewTask, repoConfig?: PerRepoConfig | null): string {
  const cleanedDescription = stripRepoLine(task.description);

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

### Step 3: Make your decision

**If the PR looks good** (no significant issues):
1. Run: \`gh pr review ${task.prNumber} --approve -b "LGTM. Automated review by Critters."\`
2. Run: \`gh pr checks ${task.prNumber} --watch --fail-fast\`
   - If checks pass → \`gh pr merge ${task.prNumber} --squash --delete-branch\`
   - If checks fail → \`gh pr review ${task.prNumber} --request-changes -b "CI checks failed. Please investigate."\` then output: REVIEW_RESULT:NEEDS_CHANGES:CI checks failed
   - If merge fails → output: REVIEW_RESULT:NEEDS_CHANGES:Merge failed
3. After successful merge, output: REVIEW_RESULT:MERGED

**If the PR needs changes** (real issues, not just style nits):
1. Write clear, actionable feedback explaining what needs to change and why
2. Run: \`gh pr review ${task.prNumber} --request-changes -b "<your feedback>"\`
3. Output: REVIEW_RESULT:NEEDS_CHANGES:<one-line summary>

## Rules
- You MUST output exactly one REVIEW_RESULT line as the very last thing you write
- Format: REVIEW_RESULT:MERGED or REVIEW_RESULT:NEEDS_CHANGES:<reason>
- Do NOT modify any files or create commits — you are a reviewer only
- Be pragmatic: minor style nits or trivial improvements should NOT block a merge. Only request changes for genuine correctness, security, or completeness issues.
- If the PR is mostly good with a minor issue, approve it with a note rather than requesting changes.`;

  const custom = readCustomPrompt("review-prompt.md");
  if (custom) {
    prompt += `\n\n## Additional Context\n${custom}`;
  }

  if (repoConfig?.reviewPrompt) {
    prompt += `\n\n## Repo-Specific Instructions\n${repoConfig.reviewPrompt.trim()}`;
  }

  return prompt;
}
