import { describe, expect, test } from "bun:test";
import { isAllowedApiUrl, isAllowedDownloadUrl, parseChecksumFile, verifyChecksum } from "../updater.js";

describe("src/updater.ts", () => {
  describe("isAllowedDownloadUrl", () => {
    // Allowed domains
    test("allows github.com", () => {
      expect(isAllowedDownloadUrl("https://github.com/org/repo/releases/download/v1.0/binary")).toBe(true);
    });

    test("allows objects.githubusercontent.com", () => {
      expect(isAllowedDownloadUrl("https://objects.githubusercontent.com/some/path")).toBe(true);
    });

    test("allows subdomains of githubusercontent.com", () => {
      expect(isAllowedDownloadUrl("https://foo.githubusercontent.com/path")).toBe(true);
    });

    // Rejected domains
    test("rejects evil.com", () => {
      expect(isAllowedDownloadUrl("https://evil.com/binary")).toBe(false);
    });

    test("rejects attacker-githubusercontent.com (suffix match bypass attempt)", () => {
      expect(isAllowedDownloadUrl("https://attacker-githubusercontent.com/binary")).toBe(false);
    });

    test("rejects githubusercontent.com.evil.com", () => {
      expect(isAllowedDownloadUrl("https://githubusercontent.com.evil.com/binary")).toBe(false);
    });

    // Protocol checks
    test("rejects http (non-https)", () => {
      expect(isAllowedDownloadUrl("http://github.com/org/repo/releases/download/v1.0/binary")).toBe(false);
    });

    test("rejects ftp protocol", () => {
      expect(isAllowedDownloadUrl("ftp://github.com/file")).toBe(false);
    });

    // Edge cases
    test("rejects empty string", () => {
      expect(isAllowedDownloadUrl("")).toBe(false);
    });

    test("rejects invalid URL", () => {
      expect(isAllowedDownloadUrl("not-a-url")).toBe(false);
    });

    test("rejects bare githubusercontent.com (not a subdomain)", () => {
      expect(isAllowedDownloadUrl("https://githubusercontent.com/path")).toBe(false);
    });
  });

  describe("isAllowedApiUrl", () => {
    test("allows api.github.com", () => {
      expect(isAllowedApiUrl("https://api.github.com/repos/org/repo/releases/latest")).toBe(true);
    });

    test("rejects non-https", () => {
      expect(isAllowedApiUrl("http://api.github.com/repos/org/repo")).toBe(false);
    });

    test("rejects other domains", () => {
      expect(isAllowedApiUrl("https://evil.com/api")).toBe(false);
    });

    test("rejects api.github.com.evil.com", () => {
      expect(isAllowedApiUrl("https://api.github.com.evil.com/repos")).toBe(false);
    });

    test("rejects empty string", () => {
      expect(isAllowedApiUrl("")).toBe(false);
    });
  });

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
});
