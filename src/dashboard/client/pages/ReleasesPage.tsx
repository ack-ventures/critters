import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill } from "../components/primitives.js";
import { fetchReleases, type ReleaseEntry } from "../lib/api.js";

function renderLine(line: string): string {
  let out = line
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  out = out
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : "#";
      return `<a href="${safe}" target="_blank" rel="noreferrer">${text}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

function shortenBody(body: string): string {
  // Drop the "Full Changelog" link tail and any "**Full Changelog**:" lines.
  return body
    .split("\n")
    .filter(l => !/^\s*\*?\s*\**Full Changelog/i.test(l))
    .join("\n")
    .trim();
}

function renderBody(body: string): string {
  const lines = shortenBody(body).split("\n");
  const parts: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (inList && !t.startsWith("* ") && t !== "") {
      parts.push("</ul>");
      inList = false;
    }
    if (t === "") continue;
    if (t.startsWith("### ")) { parts.push(`<h3>${renderLine(t.slice(4))}</h3>`); continue; }
    if (t.startsWith("## ")) { parts.push(`<h2>${renderLine(t.slice(3))}</h2>`); continue; }
    if (t.startsWith("* ")) {
      if (!inList) { parts.push("<ul>"); inList = true; }
      parts.push(`<li>${renderLine(t.slice(2))}</li>`);
      continue;
    }
    parts.push(`<p>${renderLine(t)}</p>`);
  }
  if (inList) parts.push("</ul>");
  return parts.join("\n");
}

export function ReleasesPage() {
  const [data, setData] = useState<{ current: string; releases: ReleaseEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReleases().then(setData).catch(e => setError(e.message));
  }, []);

  if (error) return <div className="app-error">Failed: {error}</div>;
  if (!data) return <div className="app-loading">Loading…</div>;

  return (
    <div className="releases-page">
      <PageHeader
        title="Release notes"
        subtitle={
          data.releases.length > 0
            ? `${data.releases.length} version${data.releases.length === 1 ? "" : "s"} · currently on v${data.current}`
            : `Currently on v${data.current}`
        }
      />
      {data.releases.length === 0 ? (
        <div className="empty-state">No release notes available (dev build).</div>
      ) : (
        <div className="releases-list">
          {data.releases.map((r) => (
            <article key={r.version} className="release-card">
              <header className="release-head">
                <h2 className="release-version">v{r.version}</h2>
                {r.current && (
                  <Pill color="var(--accent)" borderColor="color-mix(in oklch, var(--accent) 40%, transparent)">
                    <Dot color="var(--accent)" pulse /> current
                  </Pill>
                )}
                <span className="spacer" />
                <span className="release-date">{r.date}</span>
              </header>
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: content is escaped in renderLine */}
              <div className="release-body" dangerouslySetInnerHTML={{ __html: renderBody(r.body) }} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
