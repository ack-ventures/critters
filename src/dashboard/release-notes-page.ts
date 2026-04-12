import { shortenBody } from "../cli-release-notes.js";
import { escapeHtml } from "./helpers.js";

function renderMarkdown(body: string): string {
  const lines = body.split("\n");
  const htmlParts: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Close list if we're no longer on a list item
    if (inList && !trimmed.startsWith("* ")) {
      htmlParts.push("</ul>");
      inList = false;
    }

    if (trimmed === "") {
      continue;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      htmlParts.push(`<h3>${applyInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      htmlParts.push(`<h2>${applyInline(trimmed.slice(3))}</h2>`);
      continue;
    }

    // List items
    if (trimmed.startsWith("* ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${applyInline(trimmed.slice(2))}</li>`);
      continue;
    }

    // Paragraph
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
    ? `<div class="card"><p>No release notes available (dev build).</p></div>`
    : [...releaseNotes].reverse().map((release) => {
        const isCurrent = release.tag === `v${currentVersion}`;
        const currentBadge = isCurrent
          ? ' <span class="badge badge-current">current</span>'
          : "";
        const displayName = release.name && release.name !== release.tag
          ? ` &mdash; ${escapeHtml(release.name)}`
          : "";
        const cleanBody = shortenBody(release.body);
        const renderedBody = renderMarkdown(escapeHtml(cleanBody));

        return `    <div class="card">
      <div class="card-header">
        <span class="card-tag">${escapeHtml(release.tag)}${displayName}${currentBadge}</span>
        <span class="card-date">${escapeHtml(release.date)}</span>
      </div>
      <div class="card-body">${renderedBody}</div>
    </div>`;
      }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Release Notes - Critters</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x1F41B;</text></svg>">
  <style>
    :root {
      --bg: #1a1a2e;
      --card-bg: #16213e;
      --accent: #0f3460;
      --success: #4ecca3;
      --failure: #e94560;
      --text: #eee;
      --text-dim: #8892a4;
      --border: #2a2a4a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      background: var(--bg);
      color: var(--text);
      padding: 20px;
      min-height: 100vh;
    }
    a { color: #5dade2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .header h1 { font-size: 1.3rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .card-tag { font-weight: 700; font-size: 1rem; }
    .card-date { color: var(--text-dim); font-size: 0.85rem; }
    .card-body { font-size: 0.9rem; line-height: 1.6; }
    .card-body h2 { font-size: 1rem; margin: 12px 0 8px; }
    .card-body h3 { font-size: 0.95rem; margin: 10px 0 6px; }
    .card-body ul { margin: 4px 0 8px 20px; }
    .card-body li { margin-bottom: 4px; }
    .card-body p { margin-bottom: 8px; }
    .card-body code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
    .card-body a { color: #5dade2; }
    .badge-current {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(78, 204, 163, 0.15);
      color: var(--success);
    }
    @media (max-width: 768px) {
      body { padding: 12px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <a href="/dashboard">&larr; Dashboard</a>
    <h1>Release Notes</h1>
  </div>
${cards}
</body>
</html>`;
}
