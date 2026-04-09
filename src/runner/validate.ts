import { tailLines } from "../utils.js";

/**
 * Validates a phase spawn result, throwing descriptive errors for
 * timeouts and non-zero exit codes.
 */
export function validatePhaseResult(
  result: { exitCode: number; timedOut: boolean; stderr: string; stdout: string },
  phaseName: string,
): void {
  if (result.timedOut) {
    throw new Error(`Timed out during ${phaseName} phase`);
  }
  if (result.exitCode !== 0) {
    const errTail = tailLines(result.stderr || result.stdout, 20);
    const label = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${errTail}`);
  }
}
