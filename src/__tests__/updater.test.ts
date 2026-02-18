import { describe, expect, test } from "bun:test";
import { parseChecksumFile, verifyChecksum } from "../updater.js";

describe("parseChecksumFile", () => {
  test("parses standard two-entry format", () => {
    const content =
      "abc123  critters-darwin-arm64\ndef456  critters-linux-x64\n";
    const result = parseChecksumFile(content);
    expect(result.size).toBe(2);
    expect(result.get("critters-darwin-arm64")).toBe("abc123");
    expect(result.get("critters-linux-x64")).toBe("def456");
  });

  test("handles single entry", () => {
    const result = parseChecksumFile("abc123  critters-darwin-arm64\n");
    expect(result.size).toBe(1);
    expect(result.get("critters-darwin-arm64")).toBe("abc123");
  });

  test("handles empty string", () => {
    const result = parseChecksumFile("");
    expect(result.size).toBe(0);
  });

  test("handles lines with extra whitespace", () => {
    const result = parseChecksumFile("  abc123   critters-darwin-arm64  \n");
    expect(result.get("critters-darwin-arm64")).toBe("abc123");
  });

  test("ignores blank lines", () => {
    const content = "abc123  file1\n\n\ndef456  file2\n";
    const result = parseChecksumFile(content);
    expect(result.size).toBe(2);
  });

  test("handles single-space separation", () => {
    const result = parseChecksumFile("abc123 critters-darwin-arm64\n");
    expect(result.get("critters-darwin-arm64")).toBe("abc123");
  });
});

describe("verifyChecksum", () => {
  test("returns true for matching hash", () => {
    const data = Buffer.from("hello world");
    // SHA-256 of "hello world"
    const expected =
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    expect(verifyChecksum(data, expected)).toBe(true);
  });

  test("returns false for non-matching hash", () => {
    const data = Buffer.from("hello world");
    expect(verifyChecksum(data, "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
  });

  test("case-insensitive comparison", () => {
    const data = Buffer.from("hello world");
    const uppercase =
      "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9";
    expect(verifyChecksum(data, uppercase)).toBe(true);
  });

  test("known test vector: empty buffer", () => {
    const data = Buffer.from("");
    const expected =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(verifyChecksum(data, expected)).toBe(true);
  });
});
