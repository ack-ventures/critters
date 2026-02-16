# ACK-63: Log allowed tools before execution phase starts

## Summary

Add log lines in `src/spawner.ts` to print the allowed tools list before each `spawnClaude()` call (planning and execution phases). This aids debugging when a critter fails due to a missing tool — the logs will show exactly which tools were configured.

## Files to modify

### `src/spawner.ts`

Two log lines need to be added:

1. **Before the planning phase `spawnClaude()` call (after line 116):**

   After the existing `logTask(task.identifier, "Starting Phase 1: Planning");` line, add:

   ```typescript
   const planAllowedTools = getPlanningAllowedTools();
   logTask(task.identifier, `Planning phase allowed tools: ${planAllowedTools.join(", ")}`);
   ```

   Then update the `spawnClaude` call on line 121 to pass `planAllowedTools` instead of calling `getPlanningAllowedTools()` inline, so the tools are computed once and both logged and passed consistently:

   ```typescript
   const planResult = await spawnClaude(
     buildPlanningPrompt(task),
     planAllowedTools,   // was: getPlanningAllowedTools()
     workDir,
     this.config.maxPlanningTurns,
     task.identifier,
     "plan",
     abortController.signal,
   );
   ```

2. **Before the execution phase `spawnClaude()` call (after line 162, where `execAllowedTools` is already computed):**

   After the existing `const execAllowedTools = getExecutionAllowedTools(this.config, task);` line, add:

   ```typescript
   logTask(task.identifier, `Execution phase allowed tools: ${execAllowedTools.join(", ")}`);
   ```

   No other changes needed here — `execAllowedTools` is already stored in a variable.

## No new dependencies

- Uses existing `logTask` import (already imported on line 15)
- Uses existing `getPlanningAllowedTools` import (already imported on line 20)
- No new files, no new packages

## Testing approach

- **Manual verification**: Run the daemon against a test issue and confirm the two new log lines appear in stdout before each phase starts.
- **Log format check**: Verify the output matches the pattern `[timestamp] [ISSUE-ID] Planning phase allowed tools: Read, Glob, Grep, ...` and similarly for the execution phase.
- **No unit tests needed**: This is a simple logging addition with no branching logic. The existing functions (`logTask`, `getPlanningAllowedTools`, `getExecutionAllowedTools`) are already tested or trivially correct.
