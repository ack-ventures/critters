import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { Pill } from "../components/primitives.js";
import { fetchRepos, type RepoEntry } from "../lib/api.js";
import { fmtCost } from "../lib/format.js";

export function ReposPage() {
  const [repos, setRepos] = useState<RepoEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepos().then(r => setRepos(r.repos)).catch(e => setError(e.message));
  }, []);

  if (error) return <div className="app-error">Failed to load repos: {error}</div>;
  if (!repos) return <div className="app-loading">Loading…</div>;

  return (
    <>
      <PageHeader title="Repos" subtitle={`${repos.length} configured`} />
      {repos.length === 0 ? (
        <div className="empty-state">No repos configured</div>
      ) : (
        <div className="repo-grid">
          {repos.map((r) => <RepoCard key={r.url} r={r} />)}
        </div>
      )}
    </>
  );
}

function RepoCard({ r }: { r: RepoEntry }) {
  const successClass = r.successRate == null ? "" : r.successRate >= 80 ? "ok" : r.successRate >= 60 ? "warn" : "bad";
  return (
    <div className="repo-card">
      <div className="repo-head">
        <span className="repo-name">{r.short}</span>
        <span className="spacer" />
        {r.projectId && <Pill>{r.projectId}</Pill>}
      </div>
      <div className="repo-url">{r.url}</div>
      <div className="repo-stats">
        <div>
          <div className="repo-stat-label">runs 14d</div>
          <div className="repo-stat-value">{r.runs14d}</div>
        </div>
        <div>
          <div className="repo-stat-label">success</div>
          <div className={`repo-stat-value ${successClass}`}>
            {r.successRate == null ? "—" : `${r.successRate}%`}
          </div>
        </div>
        <div>
          <div className="repo-stat-label">cost 14d</div>
          <div className="repo-stat-value">{fmtCost(r.cost14d)}</div>
        </div>
      </div>
      <div className="repo-tools-label">extra tools</div>
      <div className="repo-tools">
        {r.extraTools.length > 0
          ? r.extraTools.map(x => <Pill key={x}>{x}</Pill>)
          : <span className="repo-tools-empty">(defaults only)</span>}
      </div>
    </div>
  );
}
