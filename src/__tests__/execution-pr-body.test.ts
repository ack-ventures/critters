import { describe, expect, test } from "bun:test";
import { replaceManagedSection } from "../runner/execution.js";

describe("replaceManagedSection", () => {
  const start = "<!-- critters:test:start -->";
  const end = "<!-- critters:test:end -->";

  test("appends a new managed section", () => {
    expect(replaceManagedSection("Existing body", start, end, "New content")).toBe(
      "Existing body\n\n<!-- critters:test:start -->\nNew content\n<!-- critters:test:end -->",
    );
  });

  test("replaces an existing managed section", () => {
    const body = "Existing body\n\n<!-- critters:test:start -->\nOld content\n<!-- critters:test:end -->\n\nFooter";
    expect(replaceManagedSection(body, start, end, "New content")).toBe(
      "Existing body\n\n<!-- critters:test:start -->\nNew content\n<!-- critters:test:end -->\n\nFooter",
    );
  });
});
