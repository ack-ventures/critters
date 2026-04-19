import { useMemo, useState } from "react";
import type { DashboardActivity, DashboardData } from "../../dashboard-data.js";
import { fmtAgo, fmtCost, fmtDuration, typeColor } from "../lib/format.js";
import { Dot, Pill } from "./primitives.js";

interface ActivityTableProps {
  data: DashboardData;
}

type StatusFilter = "" | "ok" | "fail";
type SortKey = "id" | "type" | "repo" | "status" | "duration" | "cost" | "when";

export function ActivityTable({ data }: ActivityTableProps) {
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "when", asc: false });

  const types = useMemo(() => {
    const set = new Set(data.activity.map((a) => a.critterType));
    return [...set].sort();
  }, [data.activity]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    const rows = data.activity.filter((a) => {
      if (typeFilter && a.critterType !== typeFilter) return false;
      const isOk = a.event === "task_completed" || a.event === "review_completed";
      if (statusFilter === "ok" && !isOk) return false;
      if (statusFilter === "fail" && isOk) return false;
      if (ql && !(a.identifier.toLowerCase().includes(ql) || a.repo.toLowerCase().includes(ql) || (a.title && a.title.toLowerCase().includes(ql)))) return false;
      return true;
    });

    const dir = sort.asc ? 1 : -1;
    const cmp = (a: DashboardActivity, b: DashboardActivity): number => {
      switch (sort.key) {
        case "id": return a.identifier.localeCompare(b.identifier) * dir;
        case "type": return a.critterType.localeCompare(b.critterType) * dir;
        case "repo": return a.repo.localeCompare(b.repo) * dir;
        case "status": {
          const aOk = a.event.endsWith("_completed") ? 1 : 0;
          const bOk = b.event.endsWith("_completed") ? 1 : 0;
          return (aOk - bOk) * dir;
        }
        case "duration": return ((a.duration ?? -1) - (b.duration ?? -1)) * dir;
        case "cost": return ((a.costUsd ?? -1) - (b.costUsd ?? -1)) * dir;
        case "when": return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir;
      }
    };
    return [...rows].sort(cmp);
  }, [data.activity, typeFilter, statusFilter, q, sort]);

  const hasFilters = Boolean(typeFilter || statusFilter || q);

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, asc: !cur.asc } : { key, asc: true }));
  }

  return (
    <div className="card" id="activity-section">
      <div className="activity-filterbar">
        <h3>Recent activity</h3>
        <span className="count">{data.activity.length} total</span>
        <span className="spacer" />
        <div className="chip-row">
          <Chip active={typeFilter === ""} onClick={() => setTypeFilter("")}>all</Chip>
          {types.map((t) => (
            <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{t}</Chip>
          ))}
        </div>
        <div className="chip-row">
          <Chip active={statusFilter === ""} onClick={() => setStatusFilter("")}>all</Chip>
          <Chip active={statusFilter === "ok"} onClick={() => setStatusFilter("ok")}>ok</Chip>
          <Chip active={statusFilter === "fail"} onClick={() => setStatusFilter("fail")}>fail</Chip>
        </div>
        <input
          type="text"
          className="activity-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter…"
        />
      </div>

      <div className="activity-table-wrap">
        <table className="activity">
          <thead>
            <tr>
              <SortableTh label="Issue" k="id" sort={sort} onClick={toggleSort} />
              <SortableTh label="Type" k="type" sort={sort} onClick={toggleSort} />
              <SortableTh label="Repo" k="repo" sort={sort} onClick={toggleSort} />
              <SortableTh label="Status" k="status" sort={sort} onClick={toggleSort} />
              <SortableTh label="Duration" k="duration" sort={sort} onClick={toggleSort} num />
              <SortableTh label="Cost" k="cost" sort={sort} onClick={toggleSort} num />
              <th>PR</th>
              <SortableTh label="When" k="when" sort={sort} onClick={toggleSort} num />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-state">No matches</td>
              </tr>
            )}
            {filtered.map((a) => <ActivityRow key={a.identifier + a.timestamp} a={a} />)}
          </tbody>
        </table>
      </div>
      <div className="activity-footer">
        <span className="count">
          {hasFilters ? `Showing ${filtered.length} of ${data.activity.length}` : `${data.activity.length} entries`}
        </span>
      </div>
    </div>
  );
}

interface SortableThProps {
  label: string;
  k: SortKey;
  sort: { key: SortKey; asc: boolean };
  onClick: (k: SortKey) => void;
  num?: boolean;
}

function SortableTh({ label, k, sort, onClick, num }: SortableThProps) {
  const active = sort.key === k;
  const arrow = active ? (sort.asc ? " ▲" : " ▼") : "";
  return (
    <th className={num ? "num" : undefined} onClick={() => onClick(k)} style={{ cursor: "pointer", userSelect: "none" }}>
      {label}{arrow}
    </th>
  );
}

function ActivityRow({ a }: { a: DashboardActivity }) {
  const isReview = a.event === "review_completed" || a.event === "review_failed";
  const isOk = a.event === "task_completed" || a.event === "review_completed";
  const statusText = isReview ? (isOk ? "reviewed" : "review·fail") : isOk ? "shipped" : "failed";
  const logHref = `/dashboard/${encodeURIComponent(a.identifier)}`;

  return (
    <tr>
      <td>
        <a className="id" href={logHref}>
          {a.identifier}
        </a>
        {a.title && <span className="issue-title">{a.title}</span>}
        {a.issueUrl && (
          <a
            className="external-link"
            href={a.issueUrl}
            target="_blank"
            rel="noreferrer"
            title="Open in tracker"
          >
            &#x2197;
          </a>
        )}
      </td>
      <td>
        <Pill color={typeColor(a.critterType)}>{a.critterType}</Pill>
      </td>
      <td className="repo">{a.repo}</td>
      <td>
        <span className={`status ${isOk ? "ok" : "fail"}`}>
          <Dot color={isOk ? "var(--green)" : "var(--danger)"} /> {statusText}
        </span>
      </td>
      <td className="dur num">{fmtDuration(a.duration)}</td>
      <td className="cost num">{fmtCost(a.costUsd)}</td>
      <td>
        {a.prUrl ? (
          <>
            <a href={a.prUrl} target="_blank" rel="noreferrer">PR</a>
            {a.prStatus && <PrStatusIcons s={a.prStatus} />}
          </>
        ) : (
          <span style={{ color: "var(--fg-3)" }}>&mdash;</span>
        )}
      </td>
      <td className="when num">{fmtAgo(a.timestamp)}</td>
    </tr>
  );
}

interface PrStatusIconsProps {
  s: { ciStatus: string; reviewStatus: string };
}

function PrStatusIcons({ s }: PrStatusIconsProps) {
  const ci = s.ciStatus === "success" ? "✅" : s.ciStatus === "failure" ? "❌" : s.ciStatus === "pending" ? "⏳" : "";
  const rev = s.reviewStatus === "approved" ? "👍" : s.reviewStatus === "changes_requested" ? "🔄" : s.reviewStatus === "pending" ? "⏳" : "";
  if (!ci && !rev) return null;
  return (
    <span className="pr-status" title={`CI: ${s.ciStatus}, Review: ${s.reviewStatus}`}>
      {ci}{rev}
    </span>
  );
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button type="button" className={`chip${active ? " active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
