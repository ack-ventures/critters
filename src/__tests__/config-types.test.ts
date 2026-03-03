import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../config.js";

const tmpDir = "/tmp/critters-config-types-test";
const validToolsYaml = 'defaultAllowedTools:\n  - "Read"\n';

function writeYaml(filename: string, content: string): string {
  const path = `${tmpDir}/${filename}`;
  writeFileSync(path, content, "utf-8");
  return path;
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  process.env.LINEAR_API_KEY = "test-key";
});

describe("config without critterTypes (backward compat)", () => {
  test("synthesizes create and review types from flat config", () => {
    const path = writeYaml("flat.yaml", `${validToolsYaml}concurrency: 3\ntimeoutMinutes: 45\n`);
    const config = loadConfig(path);

    expect(config.critterTypes).toHaveLength(2);
    expect(config.critterTypes[0].name).toBe("create");
    expect(config.critterTypes[0].concurrency).toBe(3);
    expect(config.critterTypes[0].timeoutMinutes).toBe(45);
    expect(config.critterTypes[1].name).toBe("review");
  });

  test("synthesized types use correct flat config values", () => {
    const path = writeYaml("flat-values.yaml", `${validToolsYaml}
triggerLabel: "MyLabel"
planningModel: sonnet
maxPlanningTurns: 25
reviewTriggerLabel: "My Review"
reviewModel: haiku
reviewConcurrency: 4
`);
    const config = loadConfig(path);

    const create = config.critterTypes[0];
    expect(create.trigger.label).toBe("MyLabel");
    expect(create.phases[0].model).toBe("sonnet");
    expect(create.phases[0].maxTurns).toBe(25);

    const review = config.critterTypes[1];
    expect(review.trigger.label).toBe("My Review");
    expect(review.phases[0].model).toBe("haiku");
    expect(review.concurrency).toBe(4);
  });

  test("defaults provider to linear", () => {
    const path = writeYaml("default-provider.yaml", validToolsYaml);
    const config = loadConfig(path);
    expect(config.provider).toBe("linear");
  });
});

describe("config with critterTypes", () => {
  test("parses explicit critterTypes", () => {
    const path = writeYaml("explicit.yaml", `${validToolsYaml}
critterTypes:
  mytype:
    trigger: { label: "MyLabel", status: "Todo" }
    phases:
      - name: analyze
        prompt: /tmp/analyze.md
        model: sonnet
        maxTurns: 10
        tools: [Read, Glob]
    outcomes:
      success: { status: "Done" }
      failure: { status: "Failed" }
    concurrency: 5
    timeoutMinutes: 15
`);
    const config = loadConfig(path);

    expect(config.critterTypes).toHaveLength(1);
    expect(config.critterTypes[0].name).toBe("mytype");
    expect(config.critterTypes[0].trigger.label).toBe("MyLabel");
    expect(config.critterTypes[0].concurrency).toBe(5);
    expect(config.critterTypes[0].phases[0].tools).toEqual(["Read", "Glob"]);
  });

  test("parses multiple types", () => {
    const path = writeYaml("multi.yaml", `${validToolsYaml}
critterTypes:
  create:
    trigger: { label: "Critter", status: "Todo", statusType: "unstarted" }
    repo: { clone: true, branch: true }
    phases:
      - { name: planning, prompt: "builtin:planning", model: opus, maxTurns: 50, tools: readonly }
      - { name: execution, prompt: "builtin:execution", model: opus, maxTurns: 75, tools: default }
    outcomes:
      success: { status: "In Review" }
      failure: { status: "Critter Failed" }
    concurrency: 2
    timeoutMinutes: 30
  audit:
    trigger: { label: "Audit", status: "Todo" }
    phases:
      - { name: audit, prompt: /tmp/audit.md, model: sonnet, maxTurns: 20 }
    outcomes:
      success: { status: "Done", comment: true }
      failure: { status: "Failed" }
    concurrency: 3
    timeoutMinutes: 10
`);
    const config = loadConfig(path);

    expect(config.critterTypes).toHaveLength(2);
    expect(config.critterTypes[0].name).toBe("create");
    expect(config.critterTypes[1].name).toBe("audit");
  });

  test("parses provider field", () => {
    const path = writeYaml("provider.yaml", `${validToolsYaml}
provider: linear
critterTypes:
  test:
    trigger: { label: "X", status: "Y" }
    phases:
      - { name: p, prompt: /tmp/p.md, model: opus, maxTurns: 5 }
    outcomes:
      success: { status: "Done" }
`);
    const config = loadConfig(path);
    expect(config.provider).toBe("linear");
  });

  test("rejects empty critterTypes", () => {
    const path = writeYaml("empty-types.yaml", `${validToolsYaml}\ncritterTypes: {}\n`);
    expect(() => loadConfig(path)).toThrow("empty");
  });

  test("rejects type with invalid phase", () => {
    const path = writeYaml("bad-phase.yaml", `${validToolsYaml}
critterTypes:
  broken:
    trigger: { label: "X", status: "Y" }
    phases:
      - { name: "", prompt: "f.md", model: opus, maxTurns: 10 }
    outcomes:
      success: { status: "Done" }
`);
    expect(() => loadConfig(path)).toThrow("invalid phase config");
  });
});
