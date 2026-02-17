# ACK-99: Fix and improve failure log uploads to Linear

## Summary

When a critter fails, `uploadFailureLogs` attempts to upload log files to the Linear issue as attachments. Currently, errors are silently swallowed — the catch block discards the error object and only logs a generic message. Additionally, `uploadFileToIssue` in `linear.ts` uses `logError` (not `logTaskError`) and doesn't include actual error details from the SDK calls. Finally, if uploads fail entirely, no debug info reaches the Linear issue.

This plan addresses all four problems: better error capture in the catch block, detailed per-step error logging in the upload function, and a fallback that posts truncated log excerpts directly in the Linear comment when attachments fail.

## Files to modify

### 1. `src/linear.ts` — `uploadFileToIssue` (line 144)

**Change the function signature** to accept an optional `identifier` parameter so it can use `logTaskError` instead of `logError`:

```typescript
export async function uploadFileToIssue(
  issueId: string,
  filename: string,
  content: Buffer,
  contentType: string,
  identifier?: string,
): Promise<string | null> {
```

**Add detailed error logging at each step** — wrap each of the three operations (`client.fileUpload`, `fetch` PUT, `client.createAttachment`) in try/catch blocks with specific error messages that include the actual error. Use `logTaskError` when `identifier` is provided, falling back to `logError`:

- **`client.fileUpload()`**: Wrap in try/catch. On error, log `"fileUpload() failed for ${filename}: ${err}"` and return null.
- **`fetch` PUT**: Already checks `resp.ok`, but enhance the error log to include `resp.statusText` and attempt to read `resp.text()` for the error body. Wrap in try/catch for network errors.
- **`client.createAttachment()`**: Wrap in try/catch. On error, log `"createAttachment() failed for ${filename}: ${err}"` and return null.

Use a local helper within the function:
```typescript
const logErr = identifier
  ? (msg: string) => logTaskError(identifier, msg)
  : (msg: string) => logError(msg);
```

Import `logTaskError` in `linear.ts` (currently only imports `logError`).

### 2. `src/spawner.ts` — `uploadFailureLogs` (line 312)

**Fix the catch block** (line 339):
- Change `catch {` to `catch (err)` to capture the error object.
- Include the error message in the log: `logTaskError(task.identifier, \`Failed to upload ${file.name}: ${err}\`)`.

**Pass `task.identifier` to `uploadFileToIssue`** so it can use `logTaskError`:
```typescript
const url = await uploadFileToIssue(task.issueId, file.name, content, "text/plain", task.identifier);
```

**Add fallback log excerpts in the failure comment**. After the upload loop, if not all files were successfully uploaded, read the stderr log files and include truncated excerpts (last 50 lines) directly in the Linear comment body. This is done back in the `runTask` catch block where `uploadFailureLogs` is called.

Change `uploadFailureLogs` to also return fallback log excerpts for files that failed to upload:

```typescript
async function uploadFailureLogs(
  task: CritterTask,
  workDir: string,
): Promise<{ uploaded: Array<{ name: string; url: string }>; fallbackExcerpts: string }> {
```

For each file that fails to upload (or whose `uploadFileToIssue` returns null), read its content and take the last 50 lines via `tailLines`. Accumulate these into `fallbackExcerpts` with headers like `### ${file.name} (last 50 lines)`.

Only include stderr files (`-stderr.txt`) in fallback excerpts to keep the comment size manageable.

Then in `runTask`'s catch block (line ~267-277), update to destructure the new return value:

```typescript
const { uploaded: attachmentUrls, fallbackExcerpts } = await uploadFailureLogs(task, workDir);

// ... existing failComment construction ...
if (fallbackExcerpts) {
  failComment += `\n\n<details><summary>Log excerpts</summary>\n\n${fallbackExcerpts}\n</details>`;
}
```

## Detailed change list

### `src/linear.ts`

1. **Line 2**: Add `logTaskError` to the import: `import { log, logError, logTaskError } from "./logger.js";`
2. **Line 144-180**: Rewrite `uploadFileToIssue`:
   - Add `identifier?: string` parameter
   - Add local `logErr` helper that delegates to `logTaskError` or `logError`
   - Wrap `client.fileUpload()` call (line 150) in try/catch; on error log with actual error and return null
   - Enhance the `!resp.ok` branch (line 168-170) to also log `resp.statusText`; wrap the entire fetch in try/catch for network errors
   - Wrap `client.createAttachment()` call (line 173) in try/catch; on error log with actual error and return null

### `src/spawner.ts`

1. **Line 339**: Change `catch {` to `catch (err)` and update log to include error: `logTaskError(task.identifier, \`Failed to upload ${file.name}: ${err}\`)`
2. **Line 334**: Pass `task.identifier` as 5th argument to `uploadFileToIssue`
3. **Lines 312-345**: Change return type to `{ uploaded: ...; fallbackExcerpts: string }`. Add fallback excerpt collection for stderr files that fail to upload.
4. **Lines 267-274**: Destructure the new return value; append `fallbackExcerpts` to the failure comment inside a `<details>` block.

## Dependencies

- No new dependencies needed.
- `tailLines` from `./utils.js` is already imported in `spawner.ts`.
- `readFileSync` is already imported in `spawner.ts`.

## Testing approach

- **Manual verification**: Trigger a critter failure (e.g., with an invalid repo URL) and verify:
  1. Error details appear in the console log (with task identifier prefix)
  2. If uploads succeed, attachments appear on the Linear issue
  3. If uploads fail (e.g., simulate by temporarily breaking the Linear API key), log excerpts appear in the failure comment's `<details>` block
- **Type checking**: Run `bun tsc --noEmit` (or equivalent) to verify no type errors from the signature changes
- **Code review**: Verify `logTaskError` is used (not `logError`) wherever a task identifier is available
