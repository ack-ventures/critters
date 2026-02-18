import { describe, expect, test } from "bun:test";
import { isAllowedDownloadUrl, isAllowedApiUrl } from "../updater.js";

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
});
