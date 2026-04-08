import { describe, expect, test } from "bun:test";
import { buildLogFileList } from "../task-salvage.js";

describe("buildLogFileList", () => {
  test("builds correct file list for planning + execution phases", () => {
    const files = buildLogFileList("/tmp/work", "ACK-100", [
      { name: "planning" },
      { name: "execution" },
    ]);
    expect(files).toEqual([
      { path: "/tmp/work/.critter-output-plan.json", name: "ACK-100-plan-output.txt" },
      { path: "/tmp/work/.critter-err-plan.log", name: "ACK-100-plan-stderr.txt" },
      { path: "/tmp/work/.critter-output-exec.json", name: "ACK-100-exec-output.txt" },
      { path: "/tmp/work/.critter-err-exec.log", name: "ACK-100-exec-stderr.txt" },
      { path: "/tmp/work/critters/plans/ACK-100.md", name: "ACK-100-plan.md" },
      { path: "/tmp/work/critters/plans/ACK-100.checkpoint.md", name: "ACK-100-checkpoint.md" },
    ]);
  });

  test("builds correct file list for custom phase names", () => {
    const files = buildLogFileList("/tmp/work", "ACK-200", [
      { name: "audit" },
    ]);
    expect(files).toEqual([
      { path: "/tmp/work/.critter-output-audit.json", name: "ACK-200-audit-output.txt" },
      { path: "/tmp/work/.critter-err-audit.log", name: "ACK-200-audit-stderr.txt" },
      { path: "/tmp/work/critters/plans/ACK-200.md", name: "ACK-200-plan.md" },
      { path: "/tmp/work/critters/plans/ACK-200.checkpoint.md", name: "ACK-200-checkpoint.md" },
    ]);
  });

  test("does not include .critter-report.md", () => {
    const files = buildLogFileList("/tmp/work", "ACK-300", [
      { name: "review" },
    ]);
    const paths = files.map(f => f.path);
    expect(paths.every(p => !p.includes(".critter-report.md"))).toBe(true);
  });
});
