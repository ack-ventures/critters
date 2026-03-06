import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBranch, hasCommitsOnBranch, shallowClone } from "../git.js";
import { addPrTimeoutComment, salvagePartialProgress } from "../unified-spawner.js";

let bareRepo: string;
let tempDirs: string[];

beforeEach(() => {
	tempDirs = [];

	// Create a bare repo with an initial commit on "main"
	bareRepo = mkdtempSync(join(tmpdir(), "critters-salvage-bare-"));
	tempDirs.push(bareRepo);
	execSync("git init --bare -b main", { cwd: bareRepo, stdio: "ignore" });

	const seedDir = mkdtempSync(join(tmpdir(), "critters-salvage-seed-"));
	tempDirs.push(seedDir);
	execSync(`git clone ${bareRepo} ${seedDir}/work`, { stdio: "ignore" });
	execSync("git checkout -b main", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git config user.email test@test.com", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git config user.name Test", { cwd: `${seedDir}/work`, stdio: "ignore" });
	writeFileSync(`${seedDir}/work/README.md`, "init");
	execSync("git add -A && git commit -m 'init'", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git push -u origin main", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git symbolic-ref HEAD refs/heads/main", { cwd: bareRepo, stdio: "ignore" });
});

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function cloneAndSetup(): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "critters-salvage-clone-"));
	tempDirs.push(dir);
	const target = join(dir, "repo");
	await shallowClone(bareRepo, target, "TEST-1");
	execSync("git config user.email test@test.com", { cwd: target, stdio: "ignore" });
	execSync("git config user.name Test", { cwd: target, stdio: "ignore" });
	return target;
}

describe("salvagePartialProgress", () => {
	test("returns {} when no commits on branch", async () => {
		const workDir = await cloneAndSetup();
		await createBranch(workDir, "critter/TEST-1-no-commits", "TEST-1");

		const result = await salvagePartialProgress(workDir, "critter/TEST-1-no-commits", "TEST-1", "No commits");
		expect(result).toEqual({});
	});

	test("pushes branch and returns branchPushed when commits exist but no gh available for PR", async () => {
		const workDir = await cloneAndSetup();
		const branch = "critter/TEST-1-with-commits";
		await createBranch(workDir, branch, "TEST-1");

		// Make a commit on the branch
		writeFileSync(join(workDir, "new-file.txt"), "partial work");
		execSync("git add -A && git commit -m 'partial work'", { cwd: workDir, stdio: "ignore" });

		const hasCommits = await hasCommitsOnBranch(workDir, branch, "TEST-1");
		expect(hasCommits).toBe(true);

		const result = await salvagePartialProgress(workDir, branch, "TEST-1", "With commits");
		// Since we're using a local bare repo (not GitHub), gh pr list/create will fail
		// but git push should succeed, so we get branchPushed
		expect(result.branchPushed).toBe(true);

		// Verify branch was actually pushed to the bare remote
		const remoteBranches = execSync("git branch", { cwd: bareRepo, encoding: "utf-8" });
		expect(remoteBranches).toContain("critter/TEST-1-with-commits");
	});

	test("auto-commits uncommitted changes before checking for commits", async () => {
		const workDir = await cloneAndSetup();
		const branch = "critter/TEST-1-uncommitted";
		await createBranch(workDir, branch, "TEST-1");

		// Create uncommitted changes (no manual commit)
		writeFileSync(join(workDir, "uncommitted.txt"), "work in progress");

		const result = await salvagePartialProgress(workDir, branch, "TEST-1", "Uncommitted");

		// The auto-commit should have created a commit, which then gets pushed
		expect(result.branchPushed).toBe(true);

		// Verify the commit was made
		const log = execSync("git log --oneline", { cwd: workDir, encoding: "utf-8" });
		expect(log).toContain("Auto-commit in-progress work");
	});

	test("returns {} when workDir does not exist", async () => {
		const result = await salvagePartialProgress(
			`/tmp/critters-nonexistent-dir-${Date.now()}`,
			"critter/TEST-1-missing",
			"TEST-1",
			"Missing dir",
		);
		expect(result).toEqual({});
	});

	test("returns {} when push fails (no remote configured)", async () => {
		// Create a local-only repo with no remote
		const dir = mkdtempSync(join(tmpdir(), "critters-salvage-noremote-"));
		tempDirs.push(dir);
		execSync("git init -b main", { cwd: dir, stdio: "ignore" });
		execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
		execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
		writeFileSync(join(dir, "README.md"), "init");
		execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "ignore" });
		execSync("git checkout -b critter/TEST-1-noremote", { cwd: dir, stdio: "ignore" });
		writeFileSync(join(dir, "new.txt"), "work");
		execSync("git add -A && git commit -m 'work'", { cwd: dir, stdio: "ignore" });

		const result = await salvagePartialProgress(dir, "critter/TEST-1-noremote", "TEST-1", "No remote");
		expect(result).toEqual({});
	});

	test("does not throw even when everything fails", async () => {
		// Passing a completely invalid workDir — function should catch and return {}
		const result = await salvagePartialProgress("/dev/null", "bad-branch", "TEST-1", "Bad");
		expect(result).toEqual({});
	});
});

describe("addPrTimeoutComment", () => {
	test("returns without error for malformed PR URL", async () => {
		// URL without /pull/<number> — should return silently
		await expect(
			addPrTimeoutComment("/tmp", "https://github.com/org/repo", "TEST-1", 30),
		).resolves.toBeUndefined();
	});

	test("handles gh failure gracefully", async () => {
		// Valid-looking URL but no actual GitHub repo — gh will fail, should not throw
		await expect(
			addPrTimeoutComment("/tmp", "https://github.com/org/repo/pull/999", "TEST-1", 30),
		).resolves.toBeUndefined();
	});
});
