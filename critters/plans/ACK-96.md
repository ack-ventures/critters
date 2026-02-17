# ACK-96: Add download progress bar to updater

## Summary

Replace the one-shot `arrayBuffer()` download in `src/updater.ts` with a streaming download that displays an in-place progress bar on stdout. The progress bar should only appear during interactive `critters update` (when `force` is true), not during the silent background check on daemon startup.

## Files to modify

### 1. Modify `src/updater.ts`

#### a. Add a `downloadWithProgress` helper function

Add a new function before `checkForUpdate` with the following signature and behavior:

```ts
async function downloadWithProgress(
  response: Response,
  showProgress: boolean,
): Promise<Buffer>
```

**Logic:**
1. Read `Content-Length` header from the response. Parse it to a number; if missing or invalid, set `totalBytes` to `null`.
2. If `showProgress` is false, fall back to the current behavior: `Buffer.from(await response.arrayBuffer())`.
3. If `showProgress` is true, stream the response body using `response.body` (a `ReadableStream<Uint8Array>`):
   - Allocate a growing `chunks: Uint8Array[]` array and track `receivedBytes`.
   - For each chunk, push it and update `receivedBytes`.
   - After each chunk, write the progress bar to stdout using `process.stdout.write("\r...")`.
   - When the stream ends, clear the progress line by writing `\r` + spaces + `\r`.
   - Concatenate all chunks into a single `Buffer` and return it.

**Progress bar format:**

When `totalBytes` is known:
```
Downloading... [████████░░░░░░░░░░░░] 40% 7.5MB/18.9MB
```
- Bar width: 20 characters
- Filled character: `█` (U+2588)
- Empty character: `░` (U+2591)
- Percentage shown as integer
- Sizes shown with 1 decimal place in MB (divide bytes by 1,048,576)

When `totalBytes` is unknown (no `Content-Length`):
```
Downloading... 7.5MB
```
- No bar or percentage, just the downloaded amount.

**Edge cases:**
- If `response.body` is null (shouldn't happen for a successful fetch, but defensive), fall back to `arrayBuffer()`.

#### b. Update the download section in `checkForUpdate` (lines 83-93)

Replace:
```ts
const downloadResponse = await fetch(asset.browser_download_url, {
  signal: AbortSignal.timeout(60_000),
});

if (!downloadResponse.ok) {
  printError(`Update download failed: HTTP ${downloadResponse.status}`);
  return;
}

const arrayBuffer = await downloadResponse.arrayBuffer();
writeFileSync(tempPath, Buffer.from(arrayBuffer));
```

With:
```ts
const downloadResponse = await fetch(asset.browser_download_url, {
  signal: AbortSignal.timeout(120_000),
});

if (!downloadResponse.ok) {
  printError(`Update download failed: HTTP ${downloadResponse.status}`);
  return;
}

const buffer = await downloadWithProgress(downloadResponse, force);
writeFileSync(tempPath, buffer);
```

Key changes:
- Increase timeout from 60s to 120s (streaming reads may take longer than buffered reads for large binaries).
- Pass `force` to `downloadWithProgress` so the progress bar only appears during `critters update`.
- The result is already a `Buffer`, written directly to the file.

#### c. No new imports needed

`Buffer` is a global in Bun/Node. `process.stdout.write` is also globally available. No new imports are required.

## Dependencies or setup needed

None. This uses only built-in APIs (`ReadableStream`, `process.stdout.write`, `Buffer`). No external dependencies.

## Testing approach

1. **Manual test — interactive mode**: Run `bun run src/index.ts update` (or the compiled binary with `critters update`). Verify:
   - The progress bar appears and updates in-place
   - The bar shows percentage and MB downloaded/total
   - The progress line clears after download completes
   - The "Update applied" message appears on a clean line

2. **Manual test — daemon mode**: Start the daemon with `bun run src/index.ts`. Verify:
   - No progress bar output appears during the background update check
   - The existing log messages still appear (update available / already up to date)

3. **Manual test — no Content-Length**: This is hard to test directly against GitHub, but the code path can be verified by temporarily modifying the function to force `totalBytes = null` and confirming it shows `Downloading... X.XMB` without a bar.

4. **Typecheck**: Run `bun run typecheck` to verify TypeScript compilation passes.

5. **Lint**: Run `bun run lint` to verify Biome linting passes.
