import { ClaudeCodeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import type { CliAdapter } from "./types.js";

const adapters = new Map<string, CliAdapter>();
const adaptersByBinary = new Map<string, CliAdapter>();

function registerAdapter(name: string, adapter: CliAdapter): void {
  adapters.set(name, adapter);
  adaptersByBinary.set(adapter.binary, adapter);
}

// Register built-in adapters
const claudeAdapter = new ClaudeCodeAdapter();
registerAdapter("claude", claudeAdapter);
const codexAdapter = new CodexAdapter();
registerAdapter("codex", codexAdapter);

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

export function getCliAdapterByBinary(binary: string): CliAdapter {
  const adapter = adaptersByBinary.get(binary);
  if (!adapter) {
    throw new Error(
      `Unknown CLI binary "${binary}". Available adapters: ${[...adapters.keys()].join(", ")}`,
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
