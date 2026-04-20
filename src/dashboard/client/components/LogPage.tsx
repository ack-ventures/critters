import { useCallback, useEffect, useRef, useState } from "react";
import type { IssueData } from "../lib/api.js";
import { fetchIssueData, getAuthHeaders } from "../lib/api.js";
import { fmtAgo, fmtCost, fmtDuration } from "../lib/format.js";
import { useSSE } from "../lib/useSSE.js";

function formatTokenCount(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface LogPageProps {
  identifier: string;
  embedded?: boolean;
}

export function LogPage({ identifier, embedded = false }: LogPageProps) {
  const [issueData, setIssueData] = useState<IssueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);

  // Fetch issue data on mount
  useEffect(() => {
    fetchIssueData(identifier).then((data) => {
      setIssueData(data);
      setActivePhase(data.phases[data.phases.length - 1] ?? null);
      setLoading(false);
    }).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, [identifier]);

  // For active critters, poll issue data every 10s to update phase/cost
  useEffect(() => {
    if (!issueData?.isActive) return;
    const id = setInterval(() => {
      fetchIssueData(identifier).then(setIssueData).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [identifier, issueData?.isActive]);

  if (loading) return <div className="app-loading">Loading...</div>;
  if (error || !issueData) return <div className="app-error">Failed: {error}</div>;
  if (issueData.noData) {
    return (
      <>
        {!embedded && <LogPageTopbar identifier={identifier} />}
        <div className={embedded ? undefined : "content"}>
          <div className="empty-state">
            <span className="icon">?</span>
            No data found for {identifier}.
            {!embedded && <><br /><a href="/dashboard">Back to dashboard</a></>}
          </div>
        </div>
      </>
    );
  }

  const content = (
    <>
      <IssueInfoCard data={issueData} />
      <CostSummaryCard data={issueData} />
      {issueData.phaseResults.length > 0 && <PhaseTimeline data={issueData} />}
      <LogViewerCard
        identifier={identifier}
        isActive={issueData.isActive}
        phases={issueData.phases}
        activePhase={activePhase}
        onPhaseChange={setActivePhase}
        onDone={() => {
          fetchIssueData(identifier).then(setIssueData).catch(() => {});
        }}
      />
    </>
  );

  if (embedded) return <>{content}</>;

  return (
    <>
      <LogPageTopbar issueData={issueData} identifier={identifier} />
      <div className="content">{content}</div>
    </>
  );
}

/* ---------- Topbar ---------- */

interface LogPageTopbarProps {
  identifier: string;
  issueData?: IssueData;
}

function LogPageTopbar({ identifier, issueData }: LogPageTopbarProps) {
  const statusBadge = issueData
    ? issueData.isActive
      ? <span className="badge-sm live">Live</span>
      : issueData.isFailed
        ? <span className="badge-sm fail">Failed</span>
        : issueData.isCompleted
          ? <span className="badge-sm success">Completed</span>
          : null
    : null;

  return (
    <div className="topbar">
      <a href="/dashboard" className="log-topbar-back">&larr; Dashboard</a>
      <span className="log-topbar-id">{identifier}</span>
      {statusBadge}
      {issueData?.critterType && issueData.critterType !== "\u2014" && (
        <span className="badge-sm type">{issueData.critterType}</span>
      )}
      <span className="spacer" />
      {issueData?.issueUrl && (
        <a href={issueData.issueUrl} target="_blank" rel="noreferrer" className="external-link" title="Open in tracker">
          Tracker &#x2197;
        </a>
      )}
      {issueData?.prUrl && (
        <a href={issueData.prUrl} target="_blank" rel="noreferrer" className="external-link" title="Open PR">
          PR &#x2197;
        </a>
      )}
    </div>
  );
}

/* ---------- Issue Info Card ---------- */

function IssueInfoCard({ data }: { data: IssueData }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="body">
        <h3 style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>Issue Info</h3>
        <div className="info-grid">
          <span className="label">Title</span>
          <span>{data.title}</span>
          <span className="label">Identifier</span>
          <span>
            {data.identifier}
            {data.issueUrl && (
              <a href={data.issueUrl} target="_blank" rel="noreferrer" className="external-link">&#x2197;</a>
            )}
          </span>
          <span className="label">Type</span>
          <span>{data.critterType}</span>
          <span className="label">Repo</span>
          <span>{data.repo}</span>
          <span className="label">Branch</span>
          <span><code>{data.branch}</code></span>
          {data.prUrl && (
            <>
              <span className="label">PR</span>
              <span>
                <a href={data.prUrl} target="_blank" rel="noreferrer">{data.prUrl}</a>
                {data.prStatus && <PrStatusIcons s={data.prStatus} />}
              </span>
            </>
          )}
          <span className="label">Started</span>
          <span>{data.startedAt ? fmtAgo(data.startedAt) : "\u2014"}</span>
          <span className="label">Duration</span>
          <span>{fmtDuration(data.durationMs)}</span>
        </div>
        {data.multipleRuns && (
          <div style={{ fontSize: 12, color: "var(--fg-3)", fontStyle: "italic", marginTop: 8 }}>
            Multiple runs detected for this identifier. Showing latest run.
          </div>
        )}
      </div>
    </div>
  );
}

function PrStatusIcons({ s }: { s: { ciStatus: string; reviewStatus: string } }) {
  const ci = s.ciStatus === "success" ? "\u2705" : s.ciStatus === "failure" ? "\u274C" : s.ciStatus === "pending" ? "\u23F3" : "";
  const rev = s.reviewStatus === "approved" ? "\uD83D\uDC4D" : s.reviewStatus === "changes_requested" ? "\uD83D\uDD04" : s.reviewStatus === "pending" ? "\u23F3" : "";
  if (!ci && !rev) return null;
  return (
    <span className="pr-status" title={`CI: ${s.ciStatus}, Review: ${s.reviewStatus}`}>
      {ci}{rev}
    </span>
  );
}

/* ---------- Cost Summary Card ---------- */

function CostSummaryCard({ data }: { data: IssueData }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="body">
        <h3 style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>Cost Summary</h3>
        <div className="cost-grid">
          <div className="cost-item">
            <div className="value">{fmtCost(data.cost.totalCost)}</div>
            <div className="label">Total Cost</div>
          </div>
          <div className="cost-item">
            <div className="value">{formatTokenCount(data.cost.inputTokens || undefined)}</div>
            <div className="label">Input Tokens</div>
          </div>
          <div className="cost-item">
            <div className="value">{formatTokenCount(data.cost.outputTokens || undefined)}</div>
            <div className="label">Output Tokens</div>
          </div>
          <div className="cost-item">
            <div className="value">{formatTokenCount(data.cost.cacheReadTokens || undefined)}</div>
            <div className="label">Cache Read</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Phase Timeline ---------- */

function PhaseTimeline({ data }: { data: IssueData }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="body">
        <h3 style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>Phase Timeline</h3>
        <table className="activity">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Status</th>
              <th className="num">Cost</th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              <th className="num">Cache</th>
              <th className="num">Turns</th>
            </tr>
          </thead>
          <tbody>
            {data.phaseResults.map((pr) => {
              const phaseName = pr.phase.charAt(0).toUpperCase() + pr.phase.slice(1);
              const statusBadge = pr.isRunning
                ? <span className="badge-sm running">Running</span>
                : pr.isDone
                  ? <span className="badge-sm success">Done</span>
                  : <span className="badge-sm neutral">&mdash;</span>;
              return (
                <tr key={pr.phase}>
                  <td>{phaseName}</td>
                  <td>{statusBadge}</td>
                  <td className="num">{fmtCost(pr.costUsd)}</td>
                  <td className="num">{formatTokenCount(pr.inputTokens)}</td>
                  <td className="num">{formatTokenCount(pr.outputTokens)}</td>
                  <td className="num">{formatTokenCount(pr.cacheReadTokens)}</td>
                  <td className="num">{pr.numTurns ?? "\u2014"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Log Viewer Card ---------- */

interface LogViewerCardProps {
  identifier: string;
  isActive: boolean;
  phases: string[];
  activePhase: string | null;
  onPhaseChange: (phase: string) => void;
  onDone: () => void;
}

function classifyLine(line: string): "tool" | "assistant" | "stdout" {
  if (/^\s*→\s/.test(line)) return "tool";
  if (/^\s*\[/.test(line)) return "stdout";
  return "assistant";
}

function LogViewerCard({ identifier, isActive, phases, activePhase, onPhaseChange, onDone }: LogViewerCardProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [showNewLogsBtn, setShowNewLogsBtn] = useState(false);

  // SSE for active critters
  const sseUrl = isActive && activePhase
    ? `/api/logs/${encodeURIComponent(identifier)}/stream?tail=500${activePhase ? `&phase=${encodeURIComponent(activePhase)}` : ""}`
    : null;
  const { lines: sseLines, done: sseDone } = useSSE(sseUrl, 500);

  // Static log fetch for completed critters
  const [staticLog, setStaticLog] = useState<string | null>(null);
  const [staticLoading, setStaticLoading] = useState(false);

  const fetchStaticLog = useCallback((phase: string | null) => {
    setStaticLoading(true);
    setStaticLog(null);
    let url = `/api/logs/${encodeURIComponent(identifier)}?tail=500`;
    if (phase) url += `&phase=${encodeURIComponent(phase)}`;
    fetch(url, { headers: getAuthHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error("No logs");
        return res.text();
      })
      .then((text) => {
        setStaticLog(text || "No logs available for this phase.");
        setStaticLoading(false);
      })
      .catch(() => {
        setStaticLog("No logs available for this phase.");
        setStaticLoading(false);
      });
  }, [identifier]);

  // When phase changes, fetch static logs for completed critters
  useEffect(() => {
    if (!isActive && activePhase !== null) {
      fetchStaticLog(activePhase);
    }
  }, [isActive, activePhase, fetchStaticLog]);

  // When SSE signals done, re-fetch issue data and switch to static mode
  useEffect(() => {
    if (sseDone) {
      onDone();
    }
  }, [sseDone, onDone]);

  // Auto-scroll
  const prevLinesLen = useRef(0);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const newContent = isActive ? sseLines.length > prevLinesLen.current : false;
    prevLinesLen.current = sseLines.length;
    if (newContent && !userScrolledUp) {
      el.scrollTop = el.scrollHeight;
    } else if (newContent && userScrolledUp) {
      setShowNewLogsBtn(true);
    }
  }, [sseLines, isActive, userScrolledUp]);

  // Scroll to bottom on initial load for static logs
  useEffect(() => {
    if (!isActive && staticLog && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [isActive, staticLog]);

  function handleScroll() {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setUserScrolledUp(!atBottom);
    if (atBottom) setShowNewLogsBtn(false);
  }

  function scrollToBottom() {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setUserScrolledUp(false);
    setShowNewLogsBtn(false);
  }

  const logLines = isActive
    ? sseLines
    : staticLoading || !staticLog ? [] : staticLog.split("\n");
  const placeholder = isActive
    ? (sseLines.length === 0 ? "Loading logs..." : null)
    : (staticLoading || !staticLog ? "Loading logs..." : null);

  return (
    <div className="card">
      <div className="body">
        <h3 style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>Logs</h3>
        {phases.length > 1 && (
          <div className="phase-tabs">
            {phases.map((p) => (
              <button
                key={p}
                type="button"
                className={`chip${activePhase === p ? " active" : ""}`}
                onClick={() => onPhaseChange(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        )}
        <div ref={logRef} className="log-viewer" onScroll={handleScroll}>
          {placeholder ? <span className="txt">{placeholder}</span> : logLines.map((l, i) => (
            <div key={`${i}:${l.slice(0, 40)}`} className={`ln ${classifyLine(l)}`}>
              <span className="txt">{l}</span>
            </div>
          ))}
        </div>
        {showNewLogsBtn && (
          <button type="button" className="new-logs-btn" onClick={scrollToBottom}>
            &darr; New logs
          </button>
        )}
      </div>
    </div>
  );
}
