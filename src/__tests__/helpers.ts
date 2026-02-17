import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "critters-test-"));
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

export function createTestRepo(): { path: string; cleanup: () => void } {
  const { path, cleanup } = createTempDir();
  execSync("git init --bare", { cwd: path, stdio: "ignore" });
  return { path, cleanup };
}
