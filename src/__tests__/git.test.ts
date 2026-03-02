import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	autoCommit,
	cleanupStaleWorkDirs,
	cleanupWorkDir,
	commitFile,
	createBranch,
	getDefaultBranch,
	hasCommitsOnBranch,
	hasUncommittedChanges,
	shallowClone,
} from "../git.js";
import { createTempDir, createTestRepo } from "./helpers.js";

let bareRepo: { path: string; cleanup: () => void };
let tempDirs: string[];

beforeEach(() => {
	bareRepo = createTestRepo();
	tempDirs = [];

	// Re-init bare repo with explicit main branch
	rmSync(bareRepo.path, { recursive: true, force: true });
	mkdirSync(bareRepo.path, { recursive: true });
	execSync("git init --bare -b main", { cwd: bareRepo.path, stdio: "ignore" });

	// Seed the bare repo with an initial commit on "main" branch
	const seedDir = mkdtempSync(join(tmpdir(), "critters-seed-"));
	tempDirs.push(seedDir);
	execSync(`git clone ${bareRepo.path} ${seedDir}/work`, { stdio: "ignore" });
	execSync("git checkout -b main", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git config user.email test@test.com", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git config user.name Test", { cwd: `${seedDir}/work`, stdio: "ignore" });
	writeFileSync(`${seedDir}/work/README.md`, "init");
	execSync("git add -A && git commit -m 'init'", { cwd: `${seedDir}/work`, stdio: "ignore" });
	execSync("git push -u origin main", { cwd: `${seedDir}/work`, stdio: "ignore" });
	// Set origin/HEAD in the bare repo so getDefaultBranch works
	execSync("git symbolic-ref HEAD refs/heads/main", { cwd: bareRepo.path, stdio: "ignore" });
});

afterEach(() => {
	bareRepo.cleanup();
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function cloneDir(): string {
	const { path } = createTempDir();
	tempDirs.push(path);
	return join(path, "repo");
}

async function cloneAndSetup(): Promise<string> {
	const target = cloneDir();
	await shallowClone(bareRepo.path, target, "test");
	execSync("git config user.email test@test.com", { cwd: target, stdio: "ignore" });
	execSync("git config user.name Test", { cwd: target, stdio: "ignore" });
	return target;
}

describe("shallowClone", () => {
	test("clones from local bare repo", async () => {
		const target = cloneDir();
		await shallowClone(bareRepo.path, target, "test");
		expect(existsSync(target)).toBe(true);
		expect(existsSync(join(target, ".git"))).toBe(true);
		expect(existsSync(join(target, "README.md"))).toBe(true);
	});

	test("works with cwd parameter", async () => {
		const { path: parentDir } = createTempDir();
		tempDirs.push(parentDir);
		await shallowClone(bareRepo.path, "subdir", "test", parentDir);
		expect(existsSync(join(parentDir, "subdir", ".git"))).toBe(true);
		expect(existsSync(join(parentDir, "subdir", "README.md"))).toBe(true);
	});

	test("throws on invalid repo URL", async () => {
		const target = cloneDir();
		expect(shallowClone("file:///nonexistent/repo", target, "test")).rejects.toThrow("git clone failed");
	});
});

describe("createBranch", () => {
	test("creates a new branch", async () => {
		const dir = await cloneAndSetup();
		await createBranch(dir, "test-branch", "test");
		const result = execSync("git branch", { cwd: dir, encoding: "utf-8" });
		expect(result).toContain("test-branch");
		expect(result).toMatch(/\*\s+test-branch/);
	});

	test("throws on invalid workDir", async () => {
		expect(createBranch("/nonexistent", "branch", "test")).rejects.toThrow();
	});
});

describe("getDefaultBranch", () => {
	test("detects default branch from origin/HEAD", async () => {
		const dir = await cloneAndSetup();
		const branch = await getDefaultBranch(dir, "test");
		expect(branch).toBe("main");
	});

	test("falls back to main when origin/HEAD is not set", async () => {
		const dir = await cloneAndSetup();
		execSync("git remote set-head origin -d", { cwd: dir, stdio: "ignore" });
		const branch = await getDefaultBranch(dir, "test");
		expect(branch).toBe("main");
	});
});

describe("hasCommitsOnBranch", () => {
	test("returns false with no commits on branch", async () => {
		const dir = await cloneAndSetup();
		await createBranch(dir, "feature", "test");
		const result = await hasCommitsOnBranch(dir, "feature", "test");
		expect(result).toBe(false);
	});

	test("returns true after committing on branch", async () => {
		const dir = await cloneAndSetup();
		await createBranch(dir, "feature", "test");
		writeFileSync(join(dir, "new-file.txt"), "content");
		execSync("git add -A && git commit -m 'new commit'", { cwd: dir, stdio: "ignore" });
		const result = await hasCommitsOnBranch(dir, "feature", "test");
		expect(result).toBe(true);
	});
});

describe("hasUncommittedChanges", () => {
	test("returns false on clean repo", async () => {
		const dir = await cloneAndSetup();
		const result = await hasUncommittedChanges(dir);
		expect(result).toBe(false);
	});

	test("returns true with modified file", async () => {
		const dir = await cloneAndSetup();
		writeFileSync(join(dir, "README.md"), "modified");
		const result = await hasUncommittedChanges(dir);
		expect(result).toBe(true);
	});

	test("returns true with new untracked file", async () => {
		const dir = await cloneAndSetup();
		writeFileSync(join(dir, "new-file.txt"), "new");
		const result = await hasUncommittedChanges(dir);
		expect(result).toBe(true);
	});
});

describe("autoCommit", () => {
	test("commits all uncommitted changes", async () => {
		const dir = await cloneAndSetup();
		writeFileSync(join(dir, "README.md"), "modified");
		await autoCommit(dir, "test", "auto commit msg");
		const log = execSync("git log --oneline", { cwd: dir, encoding: "utf-8" });
		expect(log).toContain("auto commit msg");
		const hasChanges = await hasUncommittedChanges(dir);
		expect(hasChanges).toBe(false);
	});

	test("handles nothing to commit", async () => {
		const dir = await cloneAndSetup();
		// Should not throw on clean repo
		await autoCommit(dir, "test", "nothing to commit");
	});
});

describe("commitFile", () => {
	test("commits a specific file", async () => {
		const dir = await cloneAndSetup();
		writeFileSync(join(dir, "test.txt"), "content");
		await commitFile(dir, "test.txt", "add test file", "test");
		const log = execSync("git log --oneline", { cwd: dir, encoding: "utf-8" });
		expect(log).toContain("add test file");
		const show = execSync("git show --name-only HEAD", { cwd: dir, encoding: "utf-8" });
		expect(show).toContain("test.txt");
	});

	test("skips when file already committed", async () => {
		const dir = await cloneAndSetup();
		writeFileSync(join(dir, "test.txt"), "content");
		await commitFile(dir, "test.txt", "first commit", "test");
		await commitFile(dir, "test.txt", "second commit", "test");
		const log = execSync("git log --oneline", { cwd: dir, encoding: "utf-8" });
		expect(log).not.toContain("second commit");
		const count = execSync("git rev-list --count HEAD", { cwd: dir, encoding: "utf-8" }).trim();
		expect(count).toBe("2"); // init + first commitFile only
	});
});

describe("cleanupWorkDir", () => {
	test("removes existing directory", () => {
		const { path } = createTempDir();
		tempDirs.push(path);
		cleanupWorkDir(path);
		expect(existsSync(path)).toBe(false);
	});

	test("does not throw for non-existent directory", () => {
		cleanupWorkDir(`/tmp/critters-nonexistent-${Date.now()}`);
	});
});

describe("cleanupStaleWorkDirs", () => {
	function setAge(dirPath: string, minutesAgo: number): void {
		const time = new Date(Date.now() - minutesAgo * 60_000);
		utimesSync(dirPath, time, time);
	}

	test("removes inactive dirs but keeps active ones", () => {
		const { path: baseDir } = createTempDir();
		tempDirs.push(baseDir);
		mkdirSync(join(baseDir, "a"));
		mkdirSync(join(baseDir, "b"));
		mkdirSync(join(baseDir, "c"));
		setAge(join(baseDir, "a"), 120);
		setAge(join(baseDir, "c"), 120);
		const activeSet = new Set([join(baseDir, "b")]);
		cleanupStaleWorkDirs(baseDir, activeSet);
		expect(existsSync(join(baseDir, "a"))).toBe(false);
		expect(existsSync(join(baseDir, "b"))).toBe(true);
		expect(existsSync(join(baseDir, "c"))).toBe(false);
	});

	test("handles non-existent base dir", () => {
		cleanupStaleWorkDirs(`/tmp/critters-nonexistent-${Date.now()}`);
	});

	test("cleans all dirs when no active set", () => {
		const { path: baseDir } = createTempDir();
		tempDirs.push(baseDir);
		mkdirSync(join(baseDir, "x"));
		mkdirSync(join(baseDir, "y"));
		setAge(join(baseDir, "x"), 120);
		setAge(join(baseDir, "y"), 120);
		cleanupStaleWorkDirs(baseDir);
		expect(existsSync(join(baseDir, "x"))).toBe(false);
		expect(existsSync(join(baseDir, "y"))).toBe(false);
	});

	test("preserves recent directories even if not in active set", () => {
		const { path: baseDir } = createTempDir();
		tempDirs.push(baseDir);
		mkdirSync(join(baseDir, "recent-a"));
		mkdirSync(join(baseDir, "recent-b"));
		cleanupStaleWorkDirs(baseDir);
		expect(existsSync(join(baseDir, "recent-a"))).toBe(true);
		expect(existsSync(join(baseDir, "recent-b"))).toBe(true);
	});

	test("deletes old directories but preserves recent ones", () => {
		const { path: baseDir } = createTempDir();
		tempDirs.push(baseDir);
		mkdirSync(join(baseDir, "old"));
		mkdirSync(join(baseDir, "recent"));
		setAge(join(baseDir, "old"), 120);
		cleanupStaleWorkDirs(baseDir);
		expect(existsSync(join(baseDir, "old"))).toBe(false);
		expect(existsSync(join(baseDir, "recent"))).toBe(true);
	});

	test("respects custom maxAgeMinutes", () => {
		const { path: baseDir1 } = createTempDir();
		tempDirs.push(baseDir1);
		mkdirSync(join(baseDir1, "dir"));
		setAge(join(baseDir1, "dir"), 10);
		cleanupStaleWorkDirs(baseDir1, undefined, 5);
		expect(existsSync(join(baseDir1, "dir"))).toBe(false);

		const { path: baseDir2 } = createTempDir();
		tempDirs.push(baseDir2);
		mkdirSync(join(baseDir2, "dir"));
		setAge(join(baseDir2, "dir"), 10);
		cleanupStaleWorkDirs(baseDir2, undefined, 15);
		expect(existsSync(join(baseDir2, "dir"))).toBe(true);
	});
});

describe("shallowClone retry logic", () => {
	test("throws after exhausting retries on invalid URL", async () => {
		const target = cloneDir();
		expect(shallowClone("file:///nonexistent/repo", target, "test")).rejects.toThrow("git clone failed");
	});
});
