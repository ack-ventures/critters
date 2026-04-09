import { describe, expect, test } from "bun:test";
import {
  type CritterTypeConfig,
  parseCritterType,
  parseCritterTypes,
  synthesizeDefaultTypes,
  validateCritterType,
} from "../critter-type.js";
import type { Config } from "../types.js";
import { makeTestConfig } from "./helpers.js";

describe("synthesizeDefaultTypes", () => {
  test("produces create and review types", () => {
    const config = makeTestConfig();
    const types = synthesizeDefaultTypes(config);

    expect(types).toHaveLength(2);
    expect(types[0].name).toBe("create");
    expect(types[1].name).toBe("review");
  });

  test("create type uses flat config values", () => {
    const config = makeTestConfig({
      triggerLabel: "MyLabel",
      concurrency: 5,
      timeoutMinutes: 45,
      planningModel: "sonnet",
      executionModel: "haiku",
      maxPlanningTurns: 30,
      maxExecutionTurns: 100,
    });
    const types = synthesizeDefaultTypes(config);
    const create = types[0];

    expect(create.trigger.label).toBe("MyLabel");
    expect(create.trigger.status).toBe("Todo");
    expect(create.trigger.statusType).toBe("unstarted");
    expect(create.concurrency).toBe(5);
    expect(create.timeoutMinutes).toBe(45);
    expect(create.repo).toEqual({ clone: true, branch: true, commitPlans: false });
    expect(create.phases).toHaveLength(2);
    expect(create.phases[0].model).toBe("sonnet");
    expect(create.phases[0].maxTurns).toBe(30);
    expect(create.phases[1].model).toBe("haiku");
    expect(create.phases[1].maxTurns).toBe(100);
    expect(create.outcomes.success.status).toBe("In Review");
    expect(create.outcomes.failure.status).toBe("Critter Failed");
  });

  test("review type uses flat config values", () => {
    const config = makeTestConfig({
      reviewTriggerLabel: "Review Me",
      reviewConcurrency: 4,
      reviewTimeoutMinutes: 20,
      reviewModel: "sonnet",
      maxReviewTurns: 50,
    });
    const types = synthesizeDefaultTypes(config);
    const review = types[1];

    expect(review.trigger.label).toBe("Review Me");
    expect(review.trigger.status).toBe("In Review");
    expect(review.concurrency).toBe(4);
    expect(review.timeoutMinutes).toBe(20);
    expect(review.phases).toHaveLength(1);
    expect(review.phases[0].model).toBe("sonnet");
    expect(review.phases[0].maxTurns).toBe(50);
    expect(review.enrichment).toBe("extractPrUrl");
    expect(review.outcomes.merged.status).toBe("Done");
    expect(review.outcomes.needsChanges.status).toBe("Human Review");
    expect(review.outcomes.failure.status).toBe("Critter Failed");
  });

  test("create type phases use builtin prompts", () => {
    const types = synthesizeDefaultTypes(makeTestConfig());
    expect(types[0].phases[0].prompt).toBe("builtin:planning");
    expect(types[0].phases[0].tools).toBe("readonly");
    expect(types[0].phases[1].prompt).toBe("builtin:execution");
    expect(types[0].phases[1].tools).toBe("default");
  });

  test("review type phase uses builtin prompt", () => {
    const types = synthesizeDefaultTypes(makeTestConfig());
    expect(types[1].phases[0].prompt).toBe("builtin:review");
    expect(types[1].phases[0].tools).toBe("review");
  });

  test("create type has claimStatus 'In Progress'", () => {
    const types = synthesizeDefaultTypes(makeTestConfig());
    expect(types[0].claimStatus).toBe("In Progress");
  });

  test("review type does not have claimStatus", () => {
    const types = synthesizeDefaultTypes(makeTestConfig());
    expect(types[1].claimStatus).toBeUndefined();
  });
});

describe("parseCritterType", () => {
  test("parses a valid custom type", () => {
    const raw = {
      trigger: { label: "Audit", status: "Todo" },
      repo: { clone: true },
      phases: [
        { name: "audit", prompt: "~/.critters/prompts/audit.md", model: "sonnet", maxTurns: 20, tools: ["Read", "Glob"] },
      ],
      outcomes: {
        success: { status: "Done", comment: true },
        failure: { status: "Failed" },
      },
      concurrency: 3,
      timeoutMinutes: 10,
    };

    const ct = parseCritterType("code-audit", raw);
    expect(ct.name).toBe("code-audit");
    expect(ct.trigger.label).toBe("Audit");
    expect(ct.trigger.status).toBe("Todo");
    expect(ct.repo.clone).toBe(true);
    expect(ct.repo.branch).toBeUndefined();
    expect(ct.phases).toHaveLength(1);
    expect(ct.phases[0].name).toBe("audit");
    expect(ct.phases[0].tools).toEqual(["Read", "Glob"]);
    expect(ct.outcomes.success).toEqual({ status: "Done", comment: true });
    expect(ct.outcomes.failure).toEqual({ status: "Failed", comment: undefined });
    expect(ct.concurrency).toBe(3);
    expect(ct.timeoutMinutes).toBe(10);
  });

  test("defaults repo to { clone: true } when not specified", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.repo.clone).toBe(true);
  });

  test("defaults concurrency and timeout", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.concurrency).toBe(2);
    expect(ct.timeoutMinutes).toBe(30);
  });

  test("defaults tools to 'default' when not specified", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.phases[0].tools).toBe("default");
  });

  test("throws when trigger is missing", () => {
    const raw = {
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    expect(() => parseCritterType("test", raw as any)).toThrow("missing trigger");
  });

  test("throws when phases is empty", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [],
      outcomes: { success: { status: "Done" } },
    };
    expect(() => parseCritterType("test", raw)).toThrow("at least one phase");
  });

  test("throws when outcomes is missing", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
    };
    expect(() => parseCritterType("test", raw as any)).toThrow("missing outcomes");
  });

  test("parses multi-phase type", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [
        { name: "analyze", prompt: "a.md", model: "sonnet", maxTurns: 10, tools: "readonly" },
        { name: "fix", prompt: "b.md", model: "opus", maxTurns: 30, tools: "default" },
      ],
      outcomes: { success: { status: "Done" }, failure: { status: "Failed" } },
    };
    const ct = parseCritterType("multi", raw);
    expect(ct.phases).toHaveLength(2);
    expect(ct.phases[0].name).toBe("analyze");
    expect(ct.phases[0].tools).toBe("readonly");
    expect(ct.phases[1].name).toBe("fix");
    expect(ct.phases[1].tools).toBe("default");
  });

  test("preserves trigger.assignee", () => {
    const raw = {
      trigger: { label: "X", status: "Y", assignee: "alice@company.com" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.trigger.assignee).toBe("alice@company.com");
  });

  test("trigger.assignee defaults to undefined", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.trigger.assignee).toBeUndefined();
  });

  test("parses skills field on phases", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [
        { name: "p", prompt: "file.md", model: "sonnet", maxTurns: 10, skills: ["~/.critters/skills/a.md", "~/.critters/skills/b.md"] },
      ],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.phases[0].skills).toEqual(["~/.critters/skills/a.md", "~/.critters/skills/b.md"]);
  });

  test("parses sandbox field on phases", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [
        { name: "review", prompt: "file.md", model: "gpt-5.4", maxTurns: 10, sandbox: "danger-full-access" },
      ],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.phases[0].sandbox).toBe("danger-full-access");
  });

  test("rejects invalid type-level cli values", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
      cli: "cluade",
    };

    expect(() => parseCritterType("test", raw)).toThrow('unknown CLI adapter "cluade"');
  });

  test("rejects invalid phase-level cli values", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5, cli: "codexx" }],
      outcomes: { success: { status: "Done" } },
    };

    expect(() => parseCritterType("test", raw)).toThrow('unknown CLI adapter "codexx"');
  });

  test("skills defaults to undefined when not specified", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.phases[0].skills).toBeUndefined();
  });

  test("preserves enrichment field", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
      enrichment: "extractPrUrl",
    };
    const ct = parseCritterType("test", raw);
    expect(ct.enrichment).toBe("extractPrUrl");
  });

  test("parses claimStatus when set", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
      claimStatus: "Reviewing",
    };
    const ct = parseCritterType("test", raw);
    expect(ct.claimStatus).toBe("Reviewing");
  });

  test("claimStatus defaults to 'In Progress' when statusType is unstarted", () => {
    const raw = {
      trigger: { label: "X", status: "Todo", statusType: "unstarted" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.claimStatus).toBe("In Progress");
  });

  test("claimStatus defaults to undefined when statusType is not unstarted", () => {
    const raw = {
      trigger: { label: "X", status: "In Review" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.claimStatus).toBeUndefined();
  });
});

describe("validateCritterType", () => {
  function validType(overrides?: Partial<CritterTypeConfig>): CritterTypeConfig {
    return {
      name: "test",
      trigger: { label: "X", status: "Y" },
      repo: { clone: true },
      phases: [{ name: "p", prompt: "f.md", model: "opus", maxTurns: 10, tools: "default" }],
      outcomes: { success: { status: "Done" } },
      concurrency: 2,
      timeoutMinutes: 30,
      ...overrides,
    };
  }

  test("accepts a valid type", () => {
    expect(() => validateCritterType(validType())).not.toThrow();
  });

  test("rejects empty name", () => {
    expect(() => validateCritterType(validType({ name: "" }))).toThrow("must have a name");
  });

  test("rejects missing trigger label", () => {
    expect(() => validateCritterType(validType({ trigger: { label: "", status: "Y" } }))).toThrow("trigger must have label and status");
  });

  test("rejects missing trigger status", () => {
    expect(() => validateCritterType(validType({ trigger: { label: "X", status: "" } }))).toThrow("trigger must have label and status");
  });

  test("rejects zero phases", () => {
    expect(() => validateCritterType(validType({ phases: [] }))).toThrow("at least one phase");
  });

  test("rejects concurrency < 1", () => {
    expect(() => validateCritterType(validType({ concurrency: 0 }))).toThrow("concurrency must be >= 1");
  });

  test("rejects timeoutMinutes <= 0", () => {
    expect(() => validateCritterType(validType({ timeoutMinutes: 0 }))).toThrow("timeoutMinutes must be > 0");
  });

  test("rejects phase with maxTurns <= 0", () => {
    expect(() => validateCritterType(validType({
      phases: [{ name: "p", prompt: "f.md", model: "opus", maxTurns: 0, tools: "default" }],
    }))).toThrow("invalid phase config");
  });

  test("rejects phase with empty name", () => {
    expect(() => validateCritterType(validType({
      phases: [{ name: "", prompt: "f.md", model: "opus", maxTurns: 10, tools: "default" }],
    }))).toThrow("invalid phase config");
  });
});

describe("parseCritterTypes (multi-provider)", () => {
  const baseRaw = {
    trigger: { label: "Critter", status: "Todo" },
    repo: { clone: true, branch: true },
    phases: [{ name: "planning", prompt: "builtin:planning", model: "opus", maxTurns: 50, tools: "readonly" }],
    outcomes: { success: { status: "Done" }, failure: { status: "Failed" } },
  };

  test("single string provider returns one entry", () => {
    const result = parseCritterTypes("create", { ...baseRaw, provider: "jira" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create");
    expect(result[0].provider).toBe("jira");
  });

  test("no provider returns one entry with undefined provider", () => {
    const result = parseCritterTypes("create", baseRaw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create");
    expect(result[0].provider).toBeUndefined();
  });

  test("array with two providers returns two entries", () => {
    const result = parseCritterTypes("create", { ...baseRaw, provider: ["linear", "jira"] });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("create:linear");
    expect(result[0].provider).toBe("linear");
    expect(result[1].name).toBe("create:jira");
    expect(result[1].provider).toBe("jira");
  });

  test("array with single provider returns one entry without suffix", () => {
    const result = parseCritterTypes("create", { ...baseRaw, provider: ["jira"] });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create");
    expect(result[0].provider).toBe("jira");
  });

  test("expanded types share the same config", () => {
    const result = parseCritterTypes("create", { ...baseRaw, provider: ["linear", "jira"], concurrency: 5 });
    expect(result[0].concurrency).toBe(5);
    expect(result[1].concurrency).toBe(5);
    expect(result[0].trigger.label).toBe("Critter");
    expect(result[1].trigger.label).toBe("Critter");
  });
});

describe("parseCritterType quietComments field", () => {
  test("parses quietComments when set to true", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
      quietComments: true,
    };
    const ct = parseCritterType("test", raw);
    expect(ct.quietComments).toBe(true);
  });

  test("parses quietComments when set to false", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
      quietComments: false,
    };
    const ct = parseCritterType("test", raw);
    expect(ct.quietComments).toBe(false);
  });

  test("quietComments defaults to undefined when absent", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.quietComments).toBeUndefined();
  });
});

describe("parseCritterType provider field", () => {
  test("preserves provider field", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
      provider: "jira",
    };
    const ct = parseCritterType("test", raw);
    expect(ct.provider).toBe("jira");
  });

  test("provider defaults to undefined when not specified", () => {
    const raw = {
      trigger: { label: "X", status: "Y" },
      phases: [{ name: "p", prompt: "file.md", model: "haiku", maxTurns: 5 }],
      outcomes: { success: { status: "Done" } },
    };
    const ct = parseCritterType("test", raw);
    expect(ct.provider).toBeUndefined();
  });
});
