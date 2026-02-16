# ACK-66: Open PRs as ready instead of draft

## Summary

Change critter behavior so that PRs are created as regular (ready for review) PRs instead of draft PRs. This requires updating the execution prompt and the corresponding status messages that reference "draft".

## Files to modify

### 1. `src/prompt.ts` — line 103

**Change:** Remove the word "draft" from the execution phase prompt instruction.

**Before:**
```
- Create a draft PR with title "[${task.identifier}] ${task.title}" and body that includes a link to the Linear issue and "Automated by Critters"
```

**After:**
```
- Create a PR with title "[${task.identifier}] ${task.title}" and body that includes a link to the Linear issue and "Automated by Critters"
```

### 2. `src/spawner.ts` — line 213

**Change:** Update the Linear comment to reflect that PRs are no longer drafts.

**Before:**
```typescript
await commentOnIssue(task.issueId, `Draft PR created: ${prUrl} (completed in ${totalDuration})`);
```

**After:**
```typescript
await commentOnIssue(task.issueId, `PR created: ${prUrl} (completed in ${totalDuration})`);
```

### 3. `src/slack.ts` — line 26

**Change:** Update the Slack notification message to reflect non-draft PRs.

**Before:**
```typescript
return `*${identifier}* — ${title}\nDraft PR created: ${prUrl}${durationSuffix}`;
```

**After:**
```typescript
return `*${identifier}* — ${title}\nPR created: ${prUrl}${durationSuffix}`;
```

## Dependencies / setup

None. These are simple string changes with no dependency or configuration impact.

## Testing approach

- **Grep verification:** After making changes, grep the `src/` directory for "draft" (case-insensitive) to confirm no remaining references.
- **TypeScript check:** Run `bun run --bun tsc --noEmit` (or equivalent) to verify the project still compiles without errors.
- **Functional verification:** The change is straightforward enough that the main risk is a typo. Review the diffs to confirm only the word "draft"/"Draft" was removed and surrounding text reads naturally.
