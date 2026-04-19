#!/usr/bin/env bun
// One-shot: scan ~/.critters/metrics.jsonl, fetch missing titles from Linear,
// rewrite the file in place.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LinearClient } from "@linear/sdk";

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("LINEAR_API_KEY not set");
  process.exit(1);
}

const metricsPath = process.argv[2] ?? join(homedir(), ".critters", "metrics.jsonl");
const content = readFileSync(metricsPath, "utf-8");
const lines = content.split("\n").filter(Boolean);

type Metric = Record<string, unknown> & { identifier?: string; title?: string };
const parsed: Metric[] = lines.map((l) => JSON.parse(l));

const missing = new Set<string>();
for (const m of parsed) {
  if (m.identifier && !m.title) missing.add(m.identifier);
}
console.log(`${missing.size} unique identifiers need titles`);

const client = new LinearClient({ apiKey });
const titles = new Map<string, string>();
const ids = [...missing];

const BATCH = 50;
for (let i = 0; i < ids.length; i += BATCH) {
  const chunk = ids.slice(i, i + BATCH);
  const result = await client.issues({
    filter: { or: chunk.map((id) => ({ number: { eq: parseInt(id.split("-")[1], 10) }, team: { key: { eq: id.split("-")[0] } } })) },
    first: BATCH * 2,
  });
  for (const issue of result.nodes) {
    titles.set(issue.identifier, issue.title);
  }
  console.log(`fetched ${Math.min(i + BATCH, ids.length)} / ${ids.length} (found ${titles.size} so far)`);
}

let patched = 0;
for (const m of parsed) {
  if (m.identifier && !m.title) {
    const t = titles.get(m.identifier);
    if (t) {
      m.title = t;
      patched++;
    }
  }
}
console.log(`patched ${patched} entries (${missing.size - titles.size} identifiers not found in Linear)`);

writeFileSync(metricsPath, parsed.map((m) => JSON.stringify(m)).join("\n") + "\n");
console.log(`wrote ${metricsPath}`);
