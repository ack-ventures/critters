const BUILTIN_CLI_ADAPTERS = ["claude", "codex"] as const;

export function getRegisteredAdapterNames(): string[] {
  return [...BUILTIN_CLI_ADAPTERS];
}

export function isRegisteredAdapterName(name: string): boolean {
  return BUILTIN_CLI_ADAPTERS.includes(name as (typeof BUILTIN_CLI_ADAPTERS)[number]);
}

export function assertValidCliAdapterName(name: string, context: string): void {
  if (!isRegisteredAdapterName(name)) {
    throw new Error(
      `${context}: unknown CLI adapter "${name}". Available adapters: ${getRegisteredAdapterNames().join(", ")}`,
    );
  }
}
