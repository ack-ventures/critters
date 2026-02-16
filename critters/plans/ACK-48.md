# ACK-48: Add a README.md

## Summary

Create a `README.md` at the project root that serves as a public-facing introduction to Critters. The content is derived from `CLAUDE.md` but rewritten in a friendlier tone for newcomers. No code changes are needed — this is a single new file.

## Files to create

### `README.md` (new file, project root)

A concise README covering the five sections specified in the task:

1. **What it is** — One-paragraph summary: a TypeScript daemon (Bun runtime) that polls Linear for issues labeled "Critter", spawns Claude Code CLI instances to plan and implement changes, and opens draft PRs for human review.

2. **Quick start** — Step-by-step setup:
   - Prerequisites: Bun, Claude Code CLI, `gh` CLI (authenticated), `tmux`, `jq`
   - Clone the repo
   - `bun install`
   - Copy `.env.example` to `.env` and set `LINEAR_API_KEY`
   - Optionally configure `critters.config.yaml`
   - Run with `bun run src/index.ts` (or `bun start`)

3. **How it works** — Brief architecture flow presented as a simple diagram or numbered list:
   - Linear issue (Critter label, Todo status) picked up by Watcher (polls every 30s)
   - Spawner clones the repo, creates a branch
   - Phase 1: Planning Claude explores codebase and writes an implementation plan
   - Phase 2: Execution Claude implements the plan, commits, pushes, and opens a draft PR
   - Status updates flow back to Linear (In Progress → In Review / Critter Failed)

4. **Configuration** — Reference the config table from CLAUDE.md (`pollIntervalSeconds`, `concurrency`, `timeoutMinutes`, `workDir`, `triggerLabel`, `maxTurns`, `defaultAllowedTools`, `repos`, `teamRepos`). Include a brief note about per-repo tool overrides.

5. **Creating tickets** — What a Linear issue needs:
   - Label: "Critter"
   - Status: "Todo"
   - Description must include `repo: git@github.com:org/repo.git` (unless mapped via config)
   - Optional: project assignment, implementation guidance in description

### Tone and style notes
- Keep it concise — each section should be a short paragraph or a brief list
- Use code blocks for commands and config snippets
- Don't duplicate CLAUDE.md verbatim; paraphrase and condense
- Point readers to CLAUDE.md for detailed contributor/developer docs
- No badges, no license section (not specified in the task)

## Dependencies or setup needed

None. This is a documentation-only change.

## Testing approach

- Verify the file renders correctly as Markdown (proper headings, code blocks, tables)
- Confirm all referenced commands are accurate (`bun install`, `bun start`, `bun run src/index.ts`)
- Confirm the config table matches `critters.config.yaml` and CLAUDE.md
- Confirm `.env.example` variables match what's documented
- No automated tests needed for a documentation file
