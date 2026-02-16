# ACK-51: Add Queue Depth Logging in Spawner

## Summary

Add logging to `src/spawner.ts` so that queue depth and running task count are logged at three key lifecycle points: when a task is queued, when it starts executing (dequeued), and when it finishes. This uses the existing `logTask` helper and the existing `queue` and `running` state already tracked by the `Spawner` class.

## Files to Modify

### `src/spawner.ts`

Three changes, all within the `Spawner` class:

#### 1. Log when a task is queued — in `dispatch()` (after line 50)

After `this.queue.push({ task, resolve })` and before `this.processQueue()`, add:

```typescript
logTask(task.identifier, `Task queued (queue: ${this.queue.length}, running: ${this.running})`);
```

This logs the queue depth *after* the push (so the count includes the newly added task) and the current number of running tasks. At this point `running` has not changed, so it reflects the true active count.

#### 2. Log when a task starts executing — in `processQueue()` (after line 66)

After `this.running++` (line 66), add:

```typescript
logTask(item.task.identifier, `Task started (queue: ${this.queue.length}, running: ${this.running})`);
```

At this point the item has already been shifted off the queue (line 64) and `running` has been incremented (line 66), so both values accurately reflect the new state: the queue is shorter by one, and running is higher by one.

#### 3. Log when a task finishes — in `processQueue()` (after line 68)

After `this.running--` (line 68) and before `item.resolve(result)` (line 69), add:

```typescript
logTask(item.task.identifier, `Task finished (queue: ${this.queue.length}, running: ${this.running})`);
```

At this point `running` has been decremented, so it accurately reflects how many tasks are still active. The queue length shows how many are still waiting.

### No other files need changes

- `src/logger.ts` — no changes needed; `logTask` already has the right signature and is already imported in `spawner.ts` (line 15).
- No new dependencies or setup required.

## Detailed Diff Preview

```diff
--- a/src/spawner.ts
+++ b/src/spawner.ts
@@ -48,6 +48,7 @@
   async dispatch(task: CritterTask): Promise<CritterResult> {
     return new Promise((resolve) => {
       this.queue.push({ task, resolve });
+      logTask(task.identifier, `Task queued (queue: ${this.queue.length}, running: ${this.running})`);
       this.processQueue();
     });
   }
@@ -64,9 +65,11 @@
       const item = this.queue.shift();
       if (!item) break;
       this.running++;
+      logTask(item.task.identifier, `Task started (queue: ${this.queue.length}, running: ${this.running})`);
       this.runTask(item.task).then((result) => {
         this.running--;
+        logTask(item.task.identifier, `Task finished (queue: ${this.queue.length}, running: ${this.running})`);
         item.resolve(result);
         this.processQueue();
       });
```

## Example Log Output

With concurrency=2, dispatching 3 tasks in quick succession:

```
[2026-02-15T10:00:00.000Z] [ACK-10] Task queued (queue: 1, running: 0)
[2026-02-15T10:00:00.001Z] [ACK-10] Task started (queue: 0, running: 1)
[2026-02-15T10:00:00.010Z] [ACK-11] Task queued (queue: 1, running: 1)
[2026-02-15T10:00:00.011Z] [ACK-11] Task started (queue: 0, running: 2)
[2026-02-15T10:00:00.020Z] [ACK-12] Task queued (queue: 1, running: 2)
...
[2026-02-15T10:05:00.000Z] [ACK-10] Task finished (queue: 1, running: 1)
[2026-02-15T10:05:00.001Z] [ACK-12] Task started (queue: 0, running: 2)
...
```

## Edge Cases

- **Single task, no queuing**: Task is pushed, logged as `queue: 1, running: 0`, then immediately started and logged as `queue: 0, running: 1`. Works correctly.
- **Queue at capacity**: When `running == concurrency`, dispatch logs `queue: N, running: 2` but `processQueue` doesn't dequeue, so no "started" log until a slot opens. Correct.
- **Shutdown (`stopped = true`)**: `processQueue` exits the while loop without dequeuing, so no misleading "started" logs are emitted. Correct.

## Testing Approach

- **Manual test**: Run critters with 3+ issues labeled "Critter" at once (concurrency=2). Verify log output shows queued/started/finished messages with correct counts.
- **Verify format**: Confirm the log lines follow the existing `[timestamp] [IDENTIFIER] message` pattern via `logTask`.
- **Verify counts**: With concurrency=2, the third task should show `queue: 1, running: 2` when queued, and only `Task started` after one of the first two finishes.
