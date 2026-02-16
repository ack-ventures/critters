function timestamp(): string {
  return new Date().toISOString();
}

export function log(message: string, ...args: unknown[]): void {
  console.log(`[${timestamp()}] ${message}`, ...args);
}

export function logError(message: string, ...args: unknown[]): void {
  console.error(`[${timestamp()}] ERROR: ${message}`, ...args);
}

export function logTask(identifier: string, message: string, ...args: unknown[]): void {
  console.log(`[${timestamp()}] [${identifier}] ${message}`, ...args);
}

export function logTaskWarn(identifier: string, message: string, ...args: unknown[]): void {
  console.warn(`[${timestamp()}] [${identifier}] WARN: ${message}`, ...args);
}

export function logTaskError(identifier: string, message: string, ...args: unknown[]): void {
  console.error(`[${timestamp()}] [${identifier}] ERROR: ${message}`, ...args);
}

export function logTaskWarn(identifier: string, message: string, ...args: unknown[]): void {
  console.warn(`[${timestamp()}] [${identifier}] WARN: ${message}`, ...args);
}
