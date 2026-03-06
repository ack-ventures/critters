import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import claudeMd from "../CLAUDE.md" with { type: "text" };
import { shellEscape } from "./utils.js";

export function buildPromptHelpSystemPrompt(
  claudeMdContent: string,
  configYaml: string | null,
  promptFiles: Array<{ name: string; content: string }>,
): string {
  const sections: string[] = [];

  sections.push(`You are a Critters configuration assistant. You help users design custom critter types,
write prompt template files, and configure their critters setup.

You are running in the user's ~/.critters/ directory. You can create and edit files here.`);

  sections.push(`## Critters Documentation\n\n${claudeMdContent}`);

  if (configYaml) {
    sections.push(`## User's Current Config\n\n\`\`\`yaml\n${configYaml}\n\`\`\``);
  } else {
    sections.push(`## User's Current Config\n\nNo config file found. Run \`critters init\` to create one, or ask me to help set one up.`);
  }

  if (promptFiles.length > 0) {
    const promptSection = promptFiles
      .map((f) => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
    sections.push(`## User's Current Prompt Files\n\n${promptSection}`);
  }

  sections.push(`## What you can help with
- Design new critter types (critterTypes config entries)
- Write prompt template files with {{variable}} substitution
- Configure multi-provider setups (Linear + Jira)
- Set up repo mappings and tool permissions
- Debug config issues

When creating prompt files, put them in ~/.critters/prompts/ and use {{identifier}},
{{title}}, {{description}}, {{branch}}, {{repoUrl}}, {{workDir}}, {{group}}, {{groupId}}
for variable substitution.`);

  return sections.join("\n\n");
}

function readConfigYaml(): string | null {
  const crittersDir = join(homedir(), ".critters");
  const primaryPath = join(crittersDir, "config.yaml");
  if (existsSync(primaryPath)) {
    return readFileSync(primaryPath, "utf-8");
  }
  const cwdPath = "./critters.config.yaml";
  if (existsSync(cwdPath)) {
    return readFileSync(cwdPath, "utf-8");
  }
  return null;
}

function readPromptFiles(): Array<{ name: string; content: string }> {
  const crittersDir = join(homedir(), ".critters");
  const files: Array<{ name: string; content: string }> = [];

  if (existsSync(crittersDir)) {
    for (const entry of readdirSync(crittersDir)) {
      if (entry.endsWith(".md")) {
        const fullPath = join(crittersDir, entry);
        files.push({ name: entry, content: readFileSync(fullPath, "utf-8") });
      }
    }
  }

  const promptsDir = join(crittersDir, "prompts");
  if (existsSync(promptsDir)) {
    for (const entry of readdirSync(promptsDir)) {
      if (entry.endsWith(".md")) {
        const fullPath = join(promptsDir, entry);
        files.push({ name: `prompts/${entry}`, content: readFileSync(fullPath, "utf-8") });
      }
    }
  }

  return files;
}

export async function runPromptHelp(): Promise<void> {
  const crittersDir = join(homedir(), ".critters");
  const hasCrittersDir = existsSync(crittersDir);

  if (!hasCrittersDir) {
    console.warn("~/.critters/ not found — run `critters init` for full setup");
  }

  const configYaml = readConfigYaml();
  const promptFiles = readPromptFiles();
  const systemPrompt = buildPromptHelpSystemPrompt(claudeMd, configYaml, promptFiles);

  const systemPromptFile = join(tmpdir(), `critters-prompt-help-${process.pid}.txt`);
  writeFileSync(systemPromptFile, systemPrompt);

  try {
    const result = spawnSync("/bin/bash", ["-c", [
      `claude`,
      `--system-prompt "$(cat ${shellEscape(systemPromptFile)})"`,
      `--allowedTools "Read,Write,Edit,Glob,Grep,Bash(ls:*),Bash(cat:*),Bash(mkdir:*)"`,
    ].join(" ")], {
      stdio: "inherit",
      cwd: hasCrittersDir ? crittersDir : tmpdir(),
      env: { ...process.env },
    });

    if (result.error) {
      console.error("Claude Code CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code");
      process.exit(1);
    }
    process.exit(result.status ?? 0);
  } finally {
    try { unlinkSync(systemPromptFile); } catch {}
  }
}
