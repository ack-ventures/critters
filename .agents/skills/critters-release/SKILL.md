---
name: critters-release
description: Release the Critters repo. Use when the user asks an agent to cut, prepare, publish, or validate a new Critters version, including version bump PRs, release tags, GitHub release workflow checks, or updating release docs before a Critters release.
---

# Critters Release

Use this workflow to release a new version of Critters from `/Users/andrew/dev/critters`.

## Guardrails

- Work from `main` unless the user explicitly asks otherwise.
- Check `git status --short --branch` before changing branches or editing files.
- Pull the latest `main` before deciding the release contents.
- Do not start the Critters daemon during release work.
- Keep release changes limited to required docs updates and the `package.json` version bump.
- Do not tag or push a tag until the release PR has merged to `main`.

## Workflow

1. Update local `main`.
   - Run `git switch main`.
   - Run `git pull --ff-only origin main`.

2. Inspect the current release state.
   - Read the current `version` from `package.json`.
   - Find the latest tag with `git describe --tags --abbrev=0`.
   - List commits since that tag with `git log --oneline <latest_tag>..HEAD`.
   - If no tag exists, compare from the root commit.

3. Ask the user for the bump type.
   - Show the current version and the commits since the last tag.
   - Ask whether this should be `patch`, `minor`, or `major`.
   - Do not choose the bump silently unless the user already specified it.

4. Create the release branch.
   - Compute the new semver version.
   - Create `release/v<new_version>` from current `main`.

5. Review documentation.
   - Check whether `README.md` covers new features, config fields, CLI changes, install/deploy changes, or behavior changes since the previous release.
   - Update `README.md` only if something user-facing is missing.

6. Bump the version.
   - Update only the `version` field in `package.json`.
   - Do not reformat or reorder `package.json`.

7. Validate.
   - Run `bun test` when practical.
   - Run `bun run typecheck`.
   - Run `bun run build`.
   - If full tests fail because of known local `Bun.serve({ port: 0 })` `EADDRINUSE` health/kill noise, report that specifically and rely on targeted checks plus CI.

8. Commit and open the release PR.
   - Commit with `Bump version to v<new_version>`.
   - Push `release/v<new_version>`.
   - Open a PR titled `Bump version to v<new_version>`.

9. Merge when green.
   - Watch CI with `gh pr checks --watch`.
   - If checks pass and the PR is mergeable, squash merge and delete the branch.
   - If checks fail, stop and report the failing check output.

10. Tag the release.

- Switch back to `main`.
- Pull merged `main` with `git pull --ff-only origin main`.
- Create an annotated tag: `git tag -a v<new_version> -m "v<new_version>"`.
- Push the tag: `git push origin v<new_version>`.

11. Verify release automation.

- Run `gh run list --workflow=release.yml --limit=1`.
- Confirm a run started for the new tag.
- If useful, watch it with `gh run watch <run_id>`.

## Notes

- `bun run build` bundles dashboard assets and release notes. If `gh` cannot reach GitHub while bundling release notes, the script keeps existing `src/release-notes.ts`; mention this if it occurs.
- Release notes and binaries are produced by the GitHub release workflow after the tag push.
