# ACK-61: Validate defaultAllowedTools is non-empty in config

## Summary

Add validation to the `validateConfig()` function in `src/config.ts` to ensure `defaultAllowedTools` is a non-empty array. Currently, if someone sets `defaultAllowedTools` to an empty array (or omits it entirely from the YAML), it defaults to `[]` on line 92 and passes validation silently. This causes critters to fail at spawn time with an unclear error because no tools are available.

## Files to modify

### `src/config.ts`

Add a validation check inside `validateConfig()` (after the existing `maxExecutionTurns` check, line 118) following the same pattern as the other numeric validators:

```typescript
if (!Array.isArray(config.defaultAllowedTools) || config.defaultAllowedTools.length === 0) {
  throw new Error("Invalid config: defaultAllowedTools must be a non-empty array of tool patterns");
}
```

This follows the existing pattern in `validateConfig()`:
- Guards use simple conditional checks on `config.*` fields
- Error messages are prefixed with `"Invalid config: "` (matching the style of lines 105-118)
- Descriptive message tells the user exactly what's expected

The `Array.isArray` check is defensive — while TypeScript types `defaultAllowedTools` as `string[]`, the YAML parser could produce unexpected types (e.g., a string if someone writes `defaultAllowedTools: "Read"` instead of a list).

### `src/config.test.ts`

Add a new `describe` block (after the existing `validateWorkDir` block) with tests:

```typescript
describe("validateConfig - defaultAllowedTools", () => {
  test("rejects empty defaultAllowedTools array", () => {
    const path = writeYaml("empty-tools.yaml", "workDir: /tmp/critters-work\ndefaultAllowedTools: []\n");
    expect(() => loadConfig(path)).toThrow("defaultAllowedTools must be a non-empty array of tool patterns");
  });

  test("rejects missing defaultAllowedTools (defaults to empty array)", () => {
    const path = writeYaml("no-tools.yaml", "workDir: /tmp/critters-work\n");
    expect(() => loadConfig(path)).toThrow("defaultAllowedTools must be a non-empty array of tool patterns");
  });

  test("accepts non-empty defaultAllowedTools", () => {
    const path = writeYaml("valid-tools.yaml", 'workDir: /tmp/critters-work\ndefaultAllowedTools:\n  - "Read"\n');
    const config = loadConfig(path);
    expect(config.defaultAllowedTools).toEqual(["Read"]);
  });
});
```

**Note:** The existing `validateWorkDir` tests that omit `defaultAllowedTools` from the YAML (e.g., the "default workDir" test on line 90-94) will now also fail this new validation. Those test YAML configs need to include a valid `defaultAllowedTools` entry. Specifically, update the `writeYaml` helper or add `defaultAllowedTools` to test configs that don't already have it. The cleanest fix is to add a helper constant and include it in each test YAML that doesn't explicitly test `defaultAllowedTools`:

Add near the top of the test file:
```typescript
const validToolsYaml = 'defaultAllowedTools:\n  - "Read"\n';
```

Then append `validToolsYaml` to each existing `writeYaml` call in the `validateWorkDir` block. For example:
```typescript
// Before:
const path = writeYaml("root.yaml", "workDir: /\n");
// After:
const path = writeYaml("root.yaml", `workDir: /\n${validToolsYaml}`);
```

This keeps existing tests focused on their original validation while satisfying the new `defaultAllowedTools` check.

## Dependencies / setup

None — no new packages or configuration changes needed.

## Testing approach

1. Run `bun test src/config.test.ts` to verify:
   - Empty `defaultAllowedTools` array throws the expected error
   - Missing `defaultAllowedTools` (falls through to `?? []`) throws the expected error
   - A valid non-empty array passes validation
   - All existing `validateWorkDir` tests still pass (after adding `defaultAllowedTools` to their YAML)
2. Verify the full config file (`critters.config.yaml`) still loads correctly by running `bun test` for the full suite.
