import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../utils.js";

const tmpDir = "/tmp/critters-jq-test";

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC matching for ANSI stripping
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

async function runJqFilter(input: string): Promise<string> {
  const inputFile = join(tmpDir, "input.jsonl");
  writeFileSync(inputFile, input);

  const result = await runCommand("jq", [
    "--unbuffered", "-cr",
    "--arg", "tool_color", "\x1b[36m",
    "-f", "src/stream-filter.jq",
    inputFile,
  ]);

  if (result.code !== 0 && result.stderr) {
    throw new Error(`jq failed (exit ${result.code}): ${result.stderr}`);
  }

  return stripAnsi(result.stdout).trimEnd();
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("stream-filter.jq", () => {
  test("system init event outputs model name", async () => {
    const event = JSON.stringify({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-5-20250929",
    });
    const output = await runJqFilter(event);
    expect(output).toBe("⚙ claude-sonnet-4-5-20250929");
  });

  test("assistant text event outputs the text", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello, world!" }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("Hello, world!");
  });

  test("assistant tool_use Read shows file path", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Read",
          input: { file_path: "/src/index.ts" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Read /src/index.ts");
  });

  test("assistant tool_use Bash shows command", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Bash",
          input: { command: "ls -la" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Bash $ ls -la");
  });

  test("assistant tool_use Glob shows pattern and path", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Glob",
          input: { pattern: "**/*.ts", path: "src/" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Glob **/*.ts in src/");
  });

  test("assistant tool_use Grep shows pattern and path", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Grep",
          input: { pattern: "TODO", path: "src/" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Grep /TODO/ in src/");
  });

  test("assistant tool_use Task shows description", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Task",
          input: { description: "explore codebase" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Task (explore codebase)");
  });

  test("user tool_use_result with stdout shows output", async () => {
    const event = JSON.stringify({
      type: "user",
      tool_use_result: {
        stdout: "file1.ts\nfile2.ts\n",
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("file1.ts\nfile2.ts");
  });

  test("user tool_use_result with >10 lines truncates output", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`);
    const event = JSON.stringify({
      type: "user",
      tool_use_result: {
        stdout: lines.join("\n") + "\n",
      },
    });
    const output = await runJqFilter(event);
    const outputLines = output.split("\n");
    expect(outputLines).toHaveLength(11); // 10 lines + truncation message
    expect(outputLines[0]).toBe("line1");
    expect(outputLines[9]).toBe("line10");
    expect(outputLines[10]).toContain("15 lines total");
  });

  test("user tool_use_result with stderr shows error output", async () => {
    const event = JSON.stringify({
      type: "user",
      tool_use_result: {
        stderr: "Error: file not found\n",
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("Error: file not found");
  });

  test("user tool_result error shows error marker", async () => {
    const event = JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          is_error: true,
          content: "Permission denied",
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("✗ Permission denied");
  });

  test("result event shows Done", async () => {
    const event = JSON.stringify({ type: "result" });
    const output = await runJqFilter(event);
    expect(output).toContain("Done");
  });

  test("subagent assistant text is indented with model tag", async () => {
    const event = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "tool-123",
      message: {
        model: "claude-haiku-4-5-20251001",
        content: [{ type: "text", text: "Searching files..." }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toContain("[haiku]");
    expect(output).toContain("Searching files...");
    // Indented with 2 spaces for subagent
    expect(output).toMatch(/^\s{2}/);
  });

  test("subagent tool_use is indented with model tag", async () => {
    const event = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "tool-456",
      message: {
        model: "claude-haiku-4-5-20251001",
        content: [{
          type: "tool_use",
          name: "Read",
          input: { file_path: "/src/foo.ts" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toContain("[haiku]");
    expect(output).toContain("Read /src/foo.ts");
    expect(output).toMatch(/^\s{2}/);
  });

  test("empty text content is filtered out", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "   \n  " }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("");
  });

  test("unknown event type produces no output", async () => {
    const event = JSON.stringify({ type: "unknown", data: "stuff" });
    const output = await runJqFilter(event);
    expect(output).toBe("");
  });

  test("user tool_use_result create shows file created", async () => {
    const event = JSON.stringify({
      type: "user",
      tool_use_result: {
        type: "create",
        filePath: "/src/new-file.ts",
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("✓ Created /src/new-file.ts");
  });

  test("user tool_use_result subagent completed shows tokens", async () => {
    const event = JSON.stringify({
      type: "user",
      tool_use_result: {
        status: "completed",
        totalTokens: 5000,
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("✓ Subagent done (5000 tokens)");
  });

  test("assistant tool_use Write shows file path", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Write",
          input: { file_path: "/src/output.ts" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Write /src/output.ts");
  });

  test("assistant tool_use Edit shows file path", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Edit",
          input: { file_path: "/src/config.ts" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ Edit /src/config.ts");
  });

  test("assistant tool_use unknown tool shows just name", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "WebSearch",
          input: { query: "test" },
        }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toBe("→ WebSearch");
  });

  test("system init with opus model extracts short name in subagent context", async () => {
    const event = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "tool-789",
      message: {
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "Planning..." }],
      },
    });
    const output = await runJqFilter(event);
    expect(output).toContain("[opus]");
  });
});
