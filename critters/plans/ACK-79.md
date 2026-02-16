# ACK-79: Respect Linear issue dependencies in watcher

## Summary

When the watcher picks up Critter-labeled issues, it should check for "blocked by" relations via the Linear SDK and skip issues whose blockers haven't reached a terminal state (`completed` or `canceled`). Blocked issues are re-evaluated on the next poll cycle.

## Files to modify

### 1. `src/types.ts` — Add blocker info to `CritterTask`

Add an optional `blockedBy` field to the `CritterTask` interface:

```typescript
export interface CritterTask {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  repoUrl: string;
  teamId: string;
  projectId?: string;
  blockedBy?: { identifier: string; status: string }[];
}
```

This field carries unresolved blocker info so the watcher can log why it's skipping an issue. It is only populated when blockers exist; omitted otherwise.

### 2. `src/linear.ts` — Fetch inverse relations in `findCritterIssues`

Within the existing loop that builds `CritterTask` objects (lines 87–101), add relation-fetching logic to populate the `blockedBy` field.

**Changes to `findCritterIssues`:**

For each issue in the loop:

1. Call `issue.inverseRelations()` to get relations where this issue is the *object* (i.e., the blocked issue). This is the correct method because in the Linear SDK, when "A is blocked by B" is set in the UI, a relation is created with `issue = B` (the blocker), `relatedIssue = A` (the blocked one), and `type = "blocks"`. So `A.inverseRelations()` returns this relation.
2. Filter for relations where `relation.type === "blocks"`.
3. For each such relation, fetch `relation.issue` (the blocker — **not** `relation.relatedIssue`) and its state.
4. Check if the blocker's state `type` field is `"completed"` or `"canceled"`. If not, it's an unresolved blocker.
5. Collect unresolved blockers as `{ identifier, status }` (where `status` is the state name, e.g. "In Review") and attach to the corresponding `CritterTask.blockedBy`.

**Concrete code outline:**

```typescript
export async function findCritterIssues(triggerLabel: string): Promise<CritterTask[]> {
  const issues = await client.issues({
    filter: {
      labels: { some: { name: { eq: triggerLabel } } },
      state: { type: { eq: "unstarted" } },
    },
    first: 20,
  });

  const tasks: CritterTask[] = [];
  for (const issue of issues.nodes) {
    const team = await issue.team;
    const project = await issue.project;
    if (!team) continue;

    // Fetch inverse relations to find issues that block this one.
    // inverseRelations() returns relations where this issue is the relatedIssue (object).
    // A relation with type "blocks" means: relation.issue blocks relation.relatedIssue.
    // So relation.issue is the blocker.
    const relations = await issue.inverseRelations();
    const blockedBy: { identifier: string; status: string }[] = [];

    for (const relation of relations.nodes) {
      if (relation.type === "blocks") {
        const blocker = await relation.issue;
        if (!blocker) continue;
        const blockerState = await blocker.state;
        if (!blockerState) continue;

        if (blockerState.type !== "completed" && blockerState.type !== "canceled") {
          blockedBy.push({
            identifier: blocker.identifier,
            status: blockerState.name,
          });
        }
      }
    }

    tasks.push({
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      repoUrl: "",
      teamId: team.id,
      projectId: project?.id,
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
    });
  }

  return tasks;
}
```

**Key detail on Linear SDK relation semantics:**
- `issue.relations()` returns relations where the issue is the **subject** (`relation.issue`). With `type: "blocks"`, this means "this issue blocks `relatedIssue`".
- `issue.inverseRelations()` returns relations where the issue is the **object** (`relation.relatedIssue`). With `type: "blocks"`, this means "`relation.issue` blocks this issue".
- We use `inverseRelations()` and read `relation.issue` to get the blocker.

### 3. `src/watcher.ts` — Skip blocked issues in `poll()`

In the `poll()` method, after the existing dedup check (line 42–44) and before the repo URL resolution (line 47), add a blocker check:

```typescript
private async poll(): Promise<void> {
  const issues = await findCritterIssues(this.config.triggerLabel);

  for (const task of issues) {
    if (this.activeIssueIds.has(task.issueId)) {
      continue;
    }

    // Check for unresolved blockers
    if (task.blockedBy && task.blockedBy.length > 0) {
      const blockerList = task.blockedBy
        .map((b) => `${b.identifier} (${b.status})`)
        .join(", ");
      logTask(task.identifier, `Blocked by ${blockerList} — skipping`);
      continue;
    }

    // Resolve repo URL (existing code continues unchanged)
    ...
  }
}
```

**Log output example:** `[2026-02-16T10:00:00.000Z] [ACK-80] Blocked by ACK-79 (In Review) — skipping`

This uses the existing `logTask` helper from `src/logger.ts` which produces the `[timestamp] [IDENTIFIER] message` format.

## Design decisions

- **No caching**: Relations are re-fetched every poll cycle. At 120s intervals with ≤20 issues, this is a handful of extra API calls per cycle — well within Linear's rate limits.
- **No circular dependency detection**: If two issues block each other, both will be perpetually skipped. This is treated as user error per the task spec.
- **Terminal states only**: Only `completed` and `canceled` resolve a blocker. Issues in `started` states like "In Review" still block.
- **Cross-team support**: `issue.inverseRelations()` is workspace-wide, so cross-team dependencies work without special handling.
- **Blocked issues stay in "Todo"**: They're not moved to a different status — they simply remain in "unstarted" and are re-evaluated each poll cycle until their blockers resolve.
- **Relation direction**: Uses `issue.inverseRelations()` with `type === "blocks"` and reads `relation.issue` to get the blocker. This correctly finds issues that block the current issue, not issues that the current issue blocks.

## Dependencies

- No new packages needed. The `@linear/sdk` already supports `issue.inverseRelations()` and the relation type/state fields.

## Testing approach

1. **Manual integration test**:
   - Create two Critter-labeled issues (e.g., ACK-100 and ACK-101)
   - Set ACK-101 as "blocked by" ACK-100 using Linear's UI
   - Both in "Todo" status
   - Start the watcher and observe:
     - ACK-100 should be picked up normally
     - ACK-101 should log "Blocked by ACK-100 (Todo) — skipping"
   - Move ACK-100 to "Done" (completed state)
   - On next poll cycle, ACK-101 should now be picked up

2. **Edge cases to verify**:
   - Issue with multiple blockers — all must be resolved
   - Issue blocked by a canceled issue — should be unblocked
   - Issue with no relations — should work as before (no regression)
   - Cross-team blocking — should work via workspace-wide relations
