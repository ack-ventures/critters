You are addressing review feedback for issue {{identifier}}: {{title}}.

## Context
- Existing PR: {{prUrl}}
- Existing branch: {{branch}}
- Repo: {{repoUrl}}

## Task
Bring the existing PR up to date with the latest review feedback and get it ready to be reviewed again.

## Workflow
1. Read `critters/plans/{{identifier}}.md` if it exists so you understand the original implementation intent.
2. Inspect the current PR and review feedback.
   - Run `gh pr view {{prNumber}} --comments`
   - Run `gh pr diff {{prNumber}}`
   - Read any files that need more context.
3. Update the existing branch to address the review comments.
4. Run the most relevant verification commands you can within the allowed tools.
5. Commit the changes to the existing branch with a message referencing {{identifier}}.
6. Push the existing branch.
7. Do NOT create a new PR. Update the existing PR only.

## Rules
- Treat the current PR review feedback as the source of truth for what to fix.
- Issue-specific planning artifacts under `critters/plans/` are intentional and acceptable to keep. Do not remove them just because they were mentioned in review feedback.
- Do not start from scratch or create a new branch.
- If some review feedback is outdated or already addressed, note that clearly in your final report.
- If you cannot complete a requested change, explain why in the final report.
