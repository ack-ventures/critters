import { useMemo, useState } from "react";
import type { DashboardData } from "../../dashboard-data.js";
import { LogPage } from "../components/LogPage.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill } from "../components/primitives.js";
import { fmtAgoShort, fmtDurationShort, shortRepo, typeColor } from "../lib/format.js";
import { useTick } from "../lib/useTick.js";

interface Props {
  data: DashboardData;
  initialIdentifier?: string | null;
}

interface RunEntry {
  identifier: string;
  title: string;
  critterType: string;
  repo: string;
  status: "running" | "ok" | "fail";
  timestamp: string;
  durationMs: number | null;
}

export function LogsPage({ data, initialIdentifier }: Props) {
  useTick(2000);

  const runs = useMemo<RunEntry[]>(() => {
    const actives: RunEntry[] = data.activeCritters.map((c) => ({
      identifier: c.identifier,
      title: c.title,
      critterType: c.critterType ?? "create",
      repo: c.repo,
      status: "running" as const,
      timestamp: new Date(c.startedAt).toISOString(),
      durationMs: Date.now() - c.startedAt,
    }));
    const seen = new Set(actives.map(a => a.identifier));
    const past: RunEntry[] = data.activity
      .filter(a => !seen.has(a.identifier))
      .map(a => ({
        identifier: a.identifier,
        title: a.title ?? a.identifier,
        critterType: a.critterType,
        repo: a.repo,
        status: (a.event === "task_completed" || a.event === "review_completed") ? "ok" as const : "fail" as const,
        timestamp: a.timestamp,
        durationMs: a.duration,
      }));
    return [...actives, ...past];
  }, [data.activeCritters, data.activity]);

  const [selId, setSelId] = useState<string | null>(
    initialIdentifier ?? runs[0]?.identifier ?? null,
  );
  const [q, setQ] = useState("");

  const filtered = runs.filter(r =>
    !q || r.identifier.toLowerCase().includes(q.toLowerCase())
      || r.title.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle={`${data.activeCritters.length} running · ${runs.length - data.activeCritters.length} recent`}
      />
      <div className="logs-split">
        <aside className="logs-runlist">
          <div className="logs-runlist-search">
            <input
              type="text"
              placeholder="filter runs…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="logs-runlist-scroll">
            {filtered.length === 0 && <div className="empty-state">no runs</div>}
            {filtered.map((r) => {
              const active = r.identifier === selId;
              const statusColor = r.status === "running"
                ? "var(--accent)"
                : r.status === "ok"
                  ? "var(--green)"
                  : "var(--danger)";
              return (
                <button
                  key={`${r.identifier}:${r.timestamp}`}
                  type="button"
                  className={`logs-run-row${active ? " selected" : ""}`}
                  style={{ borderLeftColor: active ? typeColor(r.critterType) : "transparent" }}
                  onClick={() => setSelId(r.identifier)}
                >
                  <div className="lrr-head">
                    <Dot color={statusColor} pulse={r.status === "running"} />
                    <span className="lrr-id">{r.identifier}</span>
                    <span className="spacer" />
                    <span className="lrr-ts">
                      {r.status === "running" ? fmtDurationShort(r.durationMs ?? 0) : fmtAgoShort(r.timestamp)}
                    </span>
                  </div>
                  <div className="lrr-title">{r.title}</div>
                  <div className="lrr-meta">
                    <Pill color={typeColor(r.critterType)}>{r.critterType}</Pill>
                    <span className="lrr-repo">{shortRepo(r.repo)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
        <section className="logs-detail">
          {selId ? <LogPage identifier={selId} embedded /> : <div className="empty-state">Select a run</div>}
        </section>
      </div>
    </>
  );
}
