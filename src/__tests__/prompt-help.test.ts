import { describe, expect, test } from "bun:test";
import claudeMd from "../../CLAUDE.md" with { type: "text" };
import { buildPromptHelpSystemPrompt } from "../prompt-help.js";

describe("embedded CLAUDE.md", () => {
  test("is non-empty and contains expected sections", () => {
    expect(claudeMd.length).toBeGreaterThan(0);
    expect(claudeMd).toContain("## CLI Commands");
    expect(claudeMd).toContain("critterTypes");
    expect(claudeMd).toContain("## Config");
  });
});

describe("buildPromptHelpSystemPrompt", () => {
  test("includes all sections with config and prompt files", () => {
    const result = buildPromptHelpSystemPrompt(
      "# Docs content here",
      "pollIntervalSeconds: 120\nconcurrency: 2",
      [
        { name: "planning-prompt.md", content: "Plan carefully" },
        { name: "prompts/audit.md", content: "Audit the code" },
      ],
    );

    expect(result).toContain("Critters configuration assistant");
    expect(result).toContain("# Docs content here");
    expect(result).toContain("pollIntervalSeconds: 120");
    expect(result).toContain("### planning-prompt.md");
    expect(result).toContain("Plan carefully");
    expect(result).toContain("### prompts/audit.md");
    expect(result).toContain("Audit the code");
    expect(result).toContain("{{identifier}}");
  });

  test("shows no-config message when config is null", () => {
    const result = buildPromptHelpSystemPrompt("docs", null, []);

    expect(result).toContain("No config file found");
    expect(result).toContain("critters init");
  });

  test("omits prompt files section when array is empty", () => {
    const result = buildPromptHelpSystemPrompt("docs", "key: value", []);

    expect(result).not.toContain("## User's Current Prompt Files");
  });

  test("includes prompt files section when files are present", () => {
    const result = buildPromptHelpSystemPrompt("docs", null, [
      { name: "review-prompt.md", content: "Review thoroughly" },
    ]);

    expect(result).toContain("## User's Current Prompt Files");
    expect(result).toContain("### review-prompt.md");
    expect(result).toContain("Review thoroughly");
  });
});
