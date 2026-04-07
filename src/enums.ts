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

/** Built-in prompt references */
export const BuiltinPrompt = {
  Planning: "builtin:planning",
  Execution: "builtin:execution",
  Review: "builtin:review",
} as const;
export type BuiltinPrompt = (typeof BuiltinPrompt)[keyof typeof BuiltinPrompt];

/** Tool preset names (string form used in phase config) */
export const ToolPreset = {
  Readonly: "readonly",
  Default: "default",
  Review: "review",
} as const;
export type ToolPreset = (typeof ToolPreset)[keyof typeof ToolPreset];

/** Issue tracker provider types */
export const Provider = {
  Linear: "linear",
  Jira: "jira",
} as const;
export type Provider = (typeof Provider)[keyof typeof Provider];

/** PR enrichment strategies */
export const Enrichment = {
  ExtractPrUrl: "extractPrUrl",
} as const;
export type Enrichment = (typeof Enrichment)[keyof typeof Enrichment];

/** Review phase decisions */
export const ReviewDecision = {
  Merged: "merged",
  NeedsChanges: "needs_changes",
  Unknown: "unknown",
} as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];

/** Standard outcome keys used in CritterTypeConfig.outcomes */
export const Outcome = {
  Success: "success",
  Failure: "failure",
  Merged: "merged",
  NeedsChanges: "needsChanges",
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];
