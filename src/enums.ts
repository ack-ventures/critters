/**
 * Shared constants and types used across the codebase.
 * Replaces magic strings with typed const objects.
 */

/** Built-in phase names */
export const BuiltinPhase = {
  Planning: "planning",
  Execution: "execution",
  Review: "review",
} as const;
export type BuiltinPhase = (typeof BuiltinPhase)[keyof typeof BuiltinPhase];

/** Tool preset names (string form used in phase config) */
export const ToolPreset = {
  Readonly: "readonly",
  Default: "default",
  Review: "review",
} as const;
export type ToolPreset = (typeof ToolPreset)[keyof typeof ToolPreset];

/** Review phase decisions */
export const ReviewDecision = {
  Merged: "merged",
  NeedsChanges: "needs_changes",
  Unknown: "unknown",
} as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];
