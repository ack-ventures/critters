# ACK-85: Add MIT LICENSE and update package.json metadata for OSS

## Summary

Prepare the project for open-source release by adding a standard MIT license file and updating `package.json` with metadata fields (description, repository, homepage, bugs, keywords, license) while removing the `"private": true` flag.

## Files to create/modify

### 1. Create `LICENSE`

New file at the repo root containing the standard MIT license text:

- Copyright year: 2026
- Copyright holder: ACK Ventures

```
MIT License

Copyright (c) 2026 ACK Ventures

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 2. Modify `package.json`

Apply the following changes to the existing `package.json`, keeping all other fields unchanged:

**Remove:**
- `"private": true` (line 4)

**Add (after `"version"`):**
- `"description": "TypeScript daemon that watches Linear for issues and spawns Claude Code CLI instances to produce draft PRs"`
- `"license": "MIT"`
- `"repository": { "type": "git", "url": "git+https://github.com/ack-ventures/critters.git" }`
- `"homepage": "https://github.com/ack-ventures/critters#readme"`
- `"bugs": { "url": "https://github.com/ack-ventures/critters/issues" }`
- `"keywords": ["linear", "claude-code", "automation", "ai", "pull-requests"]`

**Resulting `package.json`:**

```json
{
  "name": "critters",
  "version": "0.1.0",
  "description": "TypeScript daemon that watches Linear for issues and spawns Claude Code CLI instances to produce draft PRs",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ack-ventures/critters.git"
  },
  "homepage": "https://github.com/ack-ventures/critters#readme",
  "bugs": {
    "url": "https://github.com/ack-ventures/critters/issues"
  },
  "keywords": ["linear", "claude-code", "automation", "ai", "pull-requests"],
  "bin": {
    "critters": "src/index.ts"
  },
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/",
    "test": "bun test",
    "build": "bun build --compile src/index.ts --outfile dist/critters",
    "prepare": "husky"
  },
  "lint-staged": {
    "src/**/*.ts": ["biome check"]
  },
  "dependencies": {
    "@linear/sdk": "latest",
    "yaml": "^2"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.0",
    "@types/bun": "latest",
    "husky": "^9.1.7",
    "lint-staged": "^16.2.7",
    "typescript": "^5"
  }
}
```

## Dependencies or setup needed

None. Both changes are purely additive metadata — no new dependencies, no code changes, no build configuration updates.

## Testing approach

1. **JSON validity**: Run `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` to verify `package.json` is valid JSON after editing
2. **Field verification**: Run `node -p "const p=require('./package.json'); [!p.private, p.license==='MIT', !!p.description, !!p.repository, !!p.homepage, !!p.bugs, p.keywords.length===5].every(Boolean) ? 'PASS' : 'FAIL'"` to confirm all fields are correct
3. **LICENSE file**: Verify the file exists at the repo root, contains "MIT License", "2026", and "ACK Ventures"
4. **Existing functionality**: Run `bun run typecheck` to confirm TypeScript compilation is unaffected. Run `bun run lint` to confirm linting passes (Biome only checks `src/`, so the new root files won't be linted)
5. **bun install**: Run `bun install` to verify the lockfile is consistent with the updated `package.json` (removing `"private": true` shouldn't change dependency resolution)
