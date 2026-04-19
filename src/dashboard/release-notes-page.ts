import { shortenBody } from "../cli-release-notes.js";
import { escapeHtml } from "./helpers.js";

function renderMarkdown(body: string): string {
  const lines = body.split("\n");
  const htmlParts: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inList && !trimmed.startsWith("* ")) {
      htmlParts.push("</ul>");
      inList = false;
    }

    if (trimmed === "") {
      continue;
    }

    if (trimmed.startsWith("### ")) {
      htmlParts.push(`<h3>${applyInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      htmlParts.push(`<h2>${applyInline(trimmed.slice(3))}</h2>`);
      continue;
    }

    if (trimmed.startsWith("* ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${applyInline(trimmed.slice(2))}</li>`);
      continue;
    }

    htmlParts.push(`<p>${applyInline(trimmed)}</p>`);
  }

  if (inList) {
    htmlParts.push("</ul>");
  }

  return htmlParts.join("\n");
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderReleaseNotesPage(
  releaseNotes: Array<{ tag: string; date: string; name: string; body: string }>,
  currentVersion: string
): string {
  const cards = releaseNotes.length === 0
    ? `<div class="card"><div class="body empty">No release notes available (dev build).</div></div>`
    : releaseNotes.map((release) => {
        const isCurrent = release.tag === `v${currentVersion}`;
        const currentBadge = isCurrent
          ? ' <span class="pill pill-current">current</span>'
          : "";
        const displayName = release.name && release.name !== release.tag
          ? ` <span class="card-name">${escapeHtml(release.name)}</span>`
          : "";
        const cleanBody = shortenBody(release.body);
        const renderedBody = renderMarkdown(escapeHtml(cleanBody));

        return `    <article class="card">
      <header class="card-head">
        <div class="card-title">
          <span class="card-tag">${escapeHtml(release.tag)}</span>${displayName}${currentBadge}
        </div>
        <span class="card-date">${escapeHtml(release.date)}</span>
      </header>
      <div class="card-body">${renderedBody}</div>
    </article>`;
      }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Release Notes - Critters</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x1F41B;</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --sans: "Inter", system-ui, -apple-system, sans-serif;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

      --bg: oklch(0.16 0.008 80);
      --surface: oklch(0.195 0.008 80);
      --surface-2: oklch(0.235 0.009 80);
      --border: oklch(0.28 0.008 80);
      --border-subtle: oklch(0.235 0.008 80);
      --fg: oklch(0.96 0.005 80);
      --fg-2: oklch(0.78 0.008 80);
      --fg-3: oklch(0.58 0.008 80);

      --accent: oklch(0.78 0.14 75);
      --green: oklch(0.74 0.14 150);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: var(--bg); color: var(--fg); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
    body { min-height: 100vh; font-size: 14px; line-height: 1.5; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .page { max-width: 920px; margin: 0 auto; padding: 28px; }
    .topbar {
      display: flex; align-items: center; gap: 14px;
      padding-bottom: 18px; margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .topbar .back {
      font-family: var(--mono); font-size: 12px;
      padding: 6px 12px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--surface-2);
      color: var(--fg);
    }
    .topbar .back:hover { border-color: var(--fg-3); text-decoration: none; }
    .topbar h1 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    .topbar .meta { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--fg-3); }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .card-head {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      flex-wrap: wrap;
    }
    .card-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    .card-tag { font-family: var(--mono); font-weight: 600; font-size: 13px; color: var(--fg); }
    .card-name { font-size: 13px; color: var(--fg-2); font-weight: 500; }
    .card-date { font-family: var(--mono); font-size: 11px; color: var(--fg-3); }

    .pill {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 999px;
      font-family: var(--mono); font-size: 10px; font-weight: 500;
      letter-spacing: 0.02em; text-transform: lowercase;
      border: 1px solid var(--border);
      color: var(--fg-2); background: var(--surface-2);
    }
    .pill-current {
      color: var(--green);
      background: color-mix(in oklch, var(--green) 14%, transparent);
      border-color: color-mix(in oklch, var(--green) 35%, transparent);
    }

    .card-body { padding: 16px 18px 18px; font-size: 13px; line-height: 1.65; color: var(--fg-2); }
    .card-body h2 { font-size: 13px; font-weight: 600; color: var(--fg); margin: 14px 0 6px; letter-spacing: -0.005em; }
    .card-body h3 { font-size: 12px; font-weight: 600; color: var(--fg-2); margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.06em; font-family: var(--mono); }
    .card-body h2:first-child, .card-body h3:first-child { margin-top: 0; }
    .card-body p { margin: 0 0 8px; }
    .card-body ul { margin: 6px 0 10px 22px; }
    .card-body li { margin-bottom: 3px; }
    .card-body code {
      font-family: var(--mono); font-size: 12px;
      background: var(--surface-2); border: 1px solid var(--border-subtle);
      padding: 1px 5px; border-radius: 4px; color: var(--fg);
    }
    .card-body strong { color: var(--fg); font-weight: 600; }
    .card-body a { color: var(--accent); }
    .card-body .empty, .card .body.empty { padding: 24px 18px; text-align: center; color: var(--fg-3); font-family: var(--mono); }

    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--fg-3); }

    @media (max-width: 640px) {
      .page { padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <a class="back" href="/dashboard">&larr; Dashboard</a>
      <h1>Release notes</h1>
      <span class="meta">v${escapeHtml(currentVersion)}</span>
    </div>
${cards}
  </div>
</body>
</html>`;
}
