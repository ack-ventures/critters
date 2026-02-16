# ACK-62: Validate repo URLs in config match git URL patterns

## Summary

Add validation for repo URLs in the `validateConfig()` function in `src/config.ts`. Currently, `repos` (project ID → `RepoConfig`) and `teamRepos` (team ID → URL string) values are loaded but never checked for valid git URL formats. A typo like `http://` instead of `git@`, or a missing `.git` suffix, would only surface at clone time — potentially long after startup. This change catches invalid URLs at config load time with clear error messages.

## Files to modify

### `src/config.ts`

Add a `validateRepoUrls()` helper function and call it from `validateConfig()`.

**New function — `validateRepoUrls`:**

```typescript
const GIT_URL_RE = /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+\.git)$/;

function validateRepoUrls(config: Config): void {
  for (const [key, repo] of Object.entries(config.repos)) {
    if (!GIT_URL_RE.test(repo.url)) {
      throw new Error(`Invalid git URL for repo '${key}': ${repo.url}`);
    }
  }
  for (const [key, url] of Object.entries(config.teamRepos)) {
    if (!GIT_URL_RE.test(url)) {
      throw new Error(`Invalid git URL for teamRepo '${key}': ${url}`);
    }
  }
}
```

**Changes to `validateConfig`:**

Add a call to `validateRepoUrls(config)` at the end of the existing `validateConfig()` function body (after the existing numeric validations).

### `src/config.test.ts`

Add a new `describe("validateRepoUrls", ...)` block with tests covering:

1. **Valid SSH URL accepted** — `git@github.com:org/repo.git` in `repos` config loads without error
2. **Valid HTTPS URL accepted** — `https://github.com/org/repo.git` in `repos` config loads without error
3. **Invalid URL rejected (missing .git suffix)** — `git@github.com:org/repo` throws with `"Invalid git URL for repo"`
4. **Invalid URL rejected (plain HTTP without .git)** — `http://example.com/repo` throws
5. **Invalid URL rejected (random string)** — `not-a-url` throws
6. **teamRepos valid SSH URL accepted** — valid URL in `teamRepos` loads without error
7. **teamRepos invalid URL rejected** — invalid URL in `teamRepos` throws with `"Invalid git URL for teamRepo"`
8. **Empty repos/teamRepos passes** — config with no repos/teamRepos does not throw (existing behavior preserved)

Test structure follows the existing pattern: use `writeYaml()` to create config files, call `loadConfig()`, and assert with `expect(...).toThrow(...)`.

## Regex pattern details

The regex `^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+\.git)$` matches:

- **SSH format**: `git@github.com:org/repo.git`, `git@gitlab.example.com:group/subgroup/repo.git`
- **HTTPS format**: `https://github.com/org/repo.git`, `http://gitlab.local/org/repo.git`

Both require the `.git` suffix. This is consistent with the example URLs in `critters.config.yaml` and `CLAUDE.md`.

## Dependencies / setup

None — this uses only the existing `Config` type import already present in the file.

## Testing approach

- Run `bun test src/config.test.ts` to execute the new and existing tests
- Existing tests continue to pass since they don't set `repos`/`teamRepos` (empty objects pass validation)
- New tests cover both valid and invalid URLs for both `repos` and `teamRepos` config sections
