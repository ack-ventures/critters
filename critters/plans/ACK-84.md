# ACK-84: Add CI workflow to compile and publish releases

## Summary

Add a GitHub Actions workflow (`.github/workflows/release.yml`) that triggers on `v*` tag pushes, compiles critters into standalone binaries for three platforms using `bun build --compile`, and publishes them as GitHub Release assets. The asset names must match what the auto-updater in `src/updater.ts` expects: `critters-{platform}-{arch}`.

## Files to create/modify

### 1. Create `.github/workflows/release.yml`

New workflow file with two jobs: `build` (matrix) and `release`.

#### Trigger

```yaml
on:
  push:
    tags:
      - "v*"
```

#### Job 1: `build` (matrix strategy)

**Matrix:**

| Runner | OS | Arch | Output name |
|---|---|---|---|
| `macos-latest` | darwin | arm64 | `critters-darwin-arm64` |
| `macos-13` | darwin | x64 | `critters-darwin-x64` |
| `ubuntu-latest` | linux | x64 | `critters-linux-x64` |

**Steps:**

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` with `bun-version: "1.x"` (matches existing CI)
3. `bun install --frozen-lockfile`
4. Version check — verify the tag version matches `package.json` version:
   ```bash
   TAG_VERSION="${GITHUB_REF_NAME#v}"
   PKG_VERSION=$(node -p "require('./package.json').version")
   if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
     echo "::error::Tag version ($TAG_VERSION) does not match package.json version ($PKG_VERSION)"
     exit 1
   fi
   ```
   Uses `node -p` since Node.js is available on all GitHub Actions runners. This validates that the tag matches the package version before building.
5. Compile: `bun build --compile src/index.ts --outfile ${{ matrix.name }}`
   - Outputs a binary named directly as the release asset name (e.g., `critters-darwin-arm64`)
6. Upload artifact using `actions/upload-artifact@v4`:
   - `name: ${{ matrix.name }}`
   - `path: ${{ matrix.name }}`

**Matrix definition:**

```yaml
strategy:
  matrix:
    include:
      - runner: macos-latest
        name: critters-darwin-arm64
      - runner: macos-13
        name: critters-darwin-x64
      - runner: ubuntu-latest
        name: critters-linux-x64
```

Each job runs on `${{ matrix.runner }}`.

#### Job 2: `release`

**Depends on:** `build` (via `needs: build`)

**Runs on:** `ubuntu-latest`

**Permissions:** `contents: write` (required for creating releases and uploading assets)

**Steps:**

1. `actions/checkout@v4` (needed for `gh` CLI context)
2. Download all artifacts using `actions/download-artifact@v4` with `path: artifacts/` and `merge-multiple: true` — this downloads all three binaries into a single `artifacts/` directory
3. Create GitHub Release and attach assets:
   ```bash
   gh release create "$GITHUB_REF_NAME" \
     artifacts/critters-darwin-arm64 \
     artifacts/critters-darwin-x64 \
     artifacts/critters-linux-x64 \
     --generate-notes
   ```
   - Uses `GITHUB_REF_NAME` which contains the tag name (e.g., `v0.2.0`)
   - `--generate-notes` auto-generates release notes from commits since last tag
   - `GITHUB_TOKEN` is provided via the `GH_TOKEN` env var set to `${{ secrets.GITHUB_TOKEN }}`

## Design decisions

### Why `node -p` for version check instead of `jq` or `bun`
`node` is pre-installed on all GitHub Actions runners and doesn't require additional setup. Using `bun` would also work but `node -p "require('./package.json').version"` is a well-established pattern in CI.

### Why `merge-multiple: true` on download-artifact
Each build job uploads a single-file artifact with a unique name. Using `merge-multiple: true` places all downloaded files into a flat directory, which simplifies the `gh release create` command — no need to navigate nested artifact directories.

### Why `--generate-notes` instead of a changelog
Keeps things simple for now. GitHub auto-generates notes from PR titles and commit messages since the last tag. A proper changelog can be added later if needed.

### Why no `linux-arm64` build
The task spec requests three targets (darwin-arm64, darwin-x64, linux-x64). The auto-updater in `src/updater.ts` supports any `{platform}-{arch}` combo, so linux-arm64 can be added later by extending the matrix.

## Compatibility with auto-updater

The auto-updater (`src/updater.ts:54`) constructs the expected asset name as:
```typescript
const expectedName = `critters-${process.platform}-${process.arch}`;
```

And looks it up in the release assets array by exact `name` match (`updater.ts:55-57`). The workflow produces binaries named exactly `critters-darwin-arm64`, `critters-darwin-x64`, and `critters-linux-x64`, which match what Node.js/Bun report for `process.platform` and `process.arch` on these platforms.

The updater fetches from `https://api.github.com/repos/ack-ventures/critters/releases/latest` (`updater.ts:4`), so the release must be a non-draft, non-prerelease release (which is the default for `gh release create`).

## Complete workflow file

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  build:
    strategy:
      matrix:
        include:
          - runner: macos-latest
            name: critters-darwin-arm64
          - runner: macos-13
            name: critters-darwin-x64
          - runner: ubuntu-latest
            name: critters-linux-x64
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.x"

      - run: bun install --frozen-lockfile

      - name: Verify tag matches package.json version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "::error::Tag version ($TAG_VERSION) does not match package.json version ($PKG_VERSION)"
            exit 1
          fi

      - name: Compile binary
        run: bun build --compile src/index.ts --outfile ${{ matrix.name }}

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.name }}
          path: ${{ matrix.name }}

  release:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            artifacts/critters-darwin-arm64 \
            artifacts/critters-darwin-x64 \
            artifacts/critters-linux-x64 \
            --generate-notes

```

## Testing approach

1. **Syntax validation**: The YAML can be validated with `actionlint` or by pushing a test tag to a fork
2. **Dry run**: Push a test tag like `v0.1.0-test.1` to verify the workflow triggers and builds complete. Note: the version check step will fail unless `package.json` is updated to match — this is intentional as a safety check
3. **End-to-end**: Bump version in `package.json`, commit, tag with matching `v*`, push tag. Verify:
   - All three binaries compile successfully on their respective runners
   - Release is created with correct tag name
   - All three assets are attached with correct names
   - The auto-updater on an older binary successfully detects and downloads the new version
4. **Version mismatch**: Push a tag that doesn't match `package.json` version — all build jobs should fail with a clear error message
