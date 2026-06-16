import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPromptVars, resolvePrompt } from "../prompt-template.js";
import type { TrackerTask } from "../tracker/types.js";
import { createTempDir } from "./helpers.js";

let tempDir: string;
let cleanup: () => void;

beforeEach(() => {
  const tmp = createTempDir();
  tempDir = tmp.path;
  cleanup = tmp.cleanup;
});

afterEach(() => {
  cleanup();
});

function makeTask(overrides?: Partial<TrackerTask>): TrackerTask {
  return {
    id: "id-1",
    identifier: "ENG-1",
    title: "A title",
    description: "A description",
    repoUrl: "https://github.com/acme/repo",
    group: "Engineering",
    groupId: "team-1",
    labels: [],
    ...overrides,
  };
}

/** Write a prompt file and resolve it with the given vars. */
function resolveWith(template: string, vars: Record<string, string>): string {
  const file = join(tempDir, "prompt.md");
  writeFileSync(file, template);
  return resolvePrompt(file, vars) as string;
}

describe("prompt substitution safety", () => {
  test("B10: special replacement patterns in values are inserted literally", () => {
    // $&, $`, $', $$ are regex-replacement specials. They must NOT be
    // interpreted against the matched {{title}} token.
    const out = resolveWith("Title: {{title}}", {
      title: "weird $& $` $' $$ value",
    });
    expect(out).toBe("Title: weird $& $` $' $$ value");
  });

  test("B15: a value containing another {{token}} is not re-substituted", () => {
    // The title literally contains the text "{{description}}". A second
    // substitution pass would splice the description in; a single pass must not.
    const out = resolveWith("Header: {{title}}\nBody: {{description}}", {
      title: "see {{description}}",
      description: "SECRET-BODY",
    });
    expect(out).toBe("Header: see {{description}}\nBody: SECRET-BODY");
    expect(out).not.toContain("Header: see SECRET-BODY");
  });

  test("F7: unknown tokens are left intact and trigger a warning", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const out = resolveWith("Known: {{title}}, Unknown: {{nope}}", {
        title: "T",
      });
      expect(out).toBe("Known: T, Unknown: {{nope}}");
      expect(warnings.some((w) => w.includes("{{nope}}"))).toBe(true);
    } finally {
      console.warn = original;
    }
  });

  test("F7: a value containing a literal {{token}} does NOT warn", () => {
    // The title's VALUE legitimately contains the text "{{description}}" (the
    // B15 scenario). Because unknown tokens are detected during the single
    // substitution scan — not by re-scanning the output — the inserted
    // "{{description}}" must NOT be mistaken for an unresolved token.
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const out = resolveWith("Header: {{title}}\nBody: {{description}}", {
        title: "see {{description}}",
        description: "SECRET-BODY",
      });
      expect(out).toBe("Header: see {{description}}\nBody: SECRET-BODY");
      expect(warnings.length).toBe(0);
    } finally {
      console.warn = original;
    }
  });
});

describe("buildPromptVars description cleaning (B16)", () => {
  test("{{description}} strips repo:/branch: directive lines for custom types", () => {
    const task = makeTask({
      description: "Do the thing.\nrepo: acme/other\nbranch: feature/x",
    });
    const vars = buildPromptVars(task, "/work", "critter/eng-1");
    expect(vars.description).toBe("Do the thing.");
    expect(vars.description).not.toContain("repo:");
    expect(vars.description).not.toContain("branch:");
  });

  test("{{descriptionRaw}} preserves the unmodified description", () => {
    const raw = "Do the thing.\nrepo: acme/other\nbranch: feature/x";
    const task = makeTask({ description: raw });
    const vars = buildPromptVars(task, "/work", "critter/eng-1");
    expect(vars.descriptionRaw).toBe(raw);
  });

  test("cleaned description flows through a resolved custom prompt", () => {
    const task = makeTask({
      description: "Implement feature.\nrepo: acme/other",
    });
    const vars = buildPromptVars(task, "/work", "critter/eng-1");
    const out = resolveWith("Task:\n{{description}}", vars);
    expect(out).toBe("Task:\nImplement feature.");
  });
});
