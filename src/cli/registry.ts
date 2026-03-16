import { ClaudeCodeAdapter } from "./claude.js";
import type { CliAdapter } from "./types.js";

const adapters = new Map<string, CliAdapter>();

// Register built-in adapters
const claudeAdapter = new ClaudeCodeAdapter();
adapters.set("claude", claudeAdapter);

/**
 * Get a CLI adapter by name.
 * Throws if the adapter is not registered.
 */
export function getCliAdapter(name: string): CliAdapter {
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new Error(
      `Unknown CLI adapter "${name}". Available adapters: ${[...adapters.keys()].join(", ")}`,
    );
  }
  return adapter;
}

/**
 * Get all registered CLI adapter names.
 */
export function getRegisteredAdapters(): string[] {
  return [...adapters.keys()];
}
