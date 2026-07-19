import { describe, expect, test } from "bun:test";
import { extractIdentifier } from "../cli-clean.js";

describe("extractIdentifier", () => {
  test("linear-style branches", () => {
    expect(extractIdentifier("critter/ACK-123-fix-login", "critter")).toBe("ACK-123");
    expect(extractIdentifier("critter/PROJ-4-x", "critter", ["owner/repo"])).toBe("PROJ-4");
  });

  test("github sanitized branches map back to owner/repo#N", () => {
    expect(extractIdentifier("critter/owner-repo-42-fix-bug", "critter", ["owner/repo"])).toBe("owner/repo#42");
  });

  test("repos whose sanitized names share a prefix resolve via the digit anchor", () => {
    expect(
      extractIdentifier("critter/owner-repo-two-5-some-title", "critter", ["owner/repo", "owner/repo-two"]),
    ).toBe("owner/repo-two#5");
  });

  test("github branch without configured repos falls back to the linear regex (no match)", () => {
    expect(extractIdentifier("critter/owner-repo-42-fix-bug", "critter")).toBeNull();
  });

  test("returns null for non-critter branches", () => {
    expect(extractIdentifier("critter/random-branch", "critter")).toBeNull();
  });
});

describe("extractIdentifier digit-suffix repo names", () => {
  test("longest sanitized prefix wins over a digit-ending shorter repo", () => {
    // Branch for issue #7 in repo "owner/repo-42" — must not be misread as #42 in "owner/repo".
    expect(
      extractIdentifier("critter/owner-repo-42-7-title", "critter", ["owner/repo", "owner/repo-42"]),
    ).toBe("owner/repo-42#7");
    // Order of configured repos must not matter.
    expect(
      extractIdentifier("critter/owner-repo-42-7-title", "critter", ["owner/repo-42", "owner/repo"]),
    ).toBe("owner/repo-42#7");
  });
});
