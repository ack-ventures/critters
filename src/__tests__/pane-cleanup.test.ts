import { describe, expect, test } from "bun:test";
import { parsePaneList } from "../claude.js";

describe("parsePaneList", () => {
  test("parses standard critter pane output", () => {
    const output = [
      "%0 12345 bash Critters v0.9.15 | up 2h | 1 active",
      "%1 12346 bash ACK-123: Fix login bug / plan | org/repo",
      "%2 12347 bash ACK-456: Add feature / exec | org/repo | 5m",
    ].join("\n");

    const panes = parsePaneList(output);
    expect(panes).toHaveLength(3);

    // Main pane — no critter identifier
    expect(panes[0].paneId).toBe("%0");
    expect(panes[0].identifier).toBeNull();

    // Planning pane
    expect(panes[1].paneId).toBe("%1");
    expect(panes[1].identifier).toBe("ACK-123");
    expect(panes[1].title).toBe("ACK-123: Fix login bug / plan | org/repo");

    // Execution pane with elapsed time
    expect(panes[2].paneId).toBe("%2");
    expect(panes[2].identifier).toBe("ACK-456");
  });

  test("parses review pane titles", () => {
    const output = "%3 99999 bash ACK-789: Review PR / review | org/repo\n";
    const panes = parsePaneList(output);
    expect(panes).toHaveLength(1);
    expect(panes[0].identifier).toBe("ACK-789");
  });

  test("parses custom phase names", () => {
    const output = "%4 11111 bash PROJ-42: Audit code / code-audit | org/repo\n";
    const panes = parsePaneList(output);
    expect(panes).toHaveLength(1);
    expect(panes[0].identifier).toBe("PROJ-42");
  });

  test("returns null identifier for non-critter panes", () => {
    const output = [
      "%0 12345 bash my-custom-pane",
      "%1 12346 vim some-file.ts",
    ].join("\n");

    const panes = parsePaneList(output);
    expect(panes).toHaveLength(2);
    expect(panes[0].identifier).toBeNull();
    expect(panes[1].identifier).toBeNull();
  });

  test("handles empty input", () => {
    expect(parsePaneList("")).toHaveLength(0);
    expect(parsePaneList("  \n  ")).toHaveLength(0);
  });

  test("skips malformed lines with fewer than 4 parts", () => {
    const output = "%0 12345\n%1 12346 bash ACK-1: T / plan\n";
    const panes = parsePaneList(output);
    expect(panes).toHaveLength(1);
    expect(panes[0].paneId).toBe("%1");
  });
});
