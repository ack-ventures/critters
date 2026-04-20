import { useMemo } from "react";
import type { DashboardData } from "../../dashboard-data.js";
import { Card, KV } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill, Progress } from "../components/primitives.js";
import { fmtAgo, fmtCost, fmtDuration, shortRepo, typeColor } from "../lib/format.js";

interface Props {
  data: DashboardData;
}

export function CostsPage({ data }: Props) {
  const total = data.totals.totalCost;
  const byType = useMemo(
    () => Object.entries(data.typeStats).sort((a, b) => b[1].totalCost - a[1].totalCost),
    [data.typeStats],
  );
  const byRepo = useMemo(() => {
    const m = new Map<string, { total: number; runs: number }>();
    for (const a of data.activity) {
      if (!a.costUsd) continue;
      const e = m.get(a.repo) ?? { total: 0, runs: 0 };
      e.total += a.costUsd;
      e.runs += 1;
      m.set(a.repo, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [data.activity]);

  const topCosts = useMemo(() =>
    [...data.activity]
      .filter(a => a.costUsd != null)
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))
      .slice(0, 10),
    [data.activity]);

  return (
    <>
      <PageHeader
        title="Costs"
        subtitle={`${fmtCost(total)} spent across ${data.totals.totalTasks} runs (14d window)`}
      />
      <Card title="Summary">
        <div className="kv-grid-4">
          <KV k="spent (14d)" v={fmtCost(total)} />
          <KV k="projected (30d)" v={fmtCost(total * 30 / 14)} />
          <KV k="avg / task" v={fmtCost(data.totals.avgCost)} />
          <KV k="avg duration" v={fmtDuration(data.totals.avgDuration)} />
        </div>
      </Card>

      <div className="two-col">
        <Card title="By critter type">
          {byType.length === 0 && <div className="empty-state">no data</div>}
          {byType.map(([t, s]) => (
            <div key={t} className="cost-breakdown-row">
              <div className="cbr-head">
                <span><Dot color={typeColor(t)} size={7} /> {t}</span>
                <span className="dim">{fmtCost(s.totalCost)} · {s.total} runs</span>
              </div>
              <Progress value={total > 0 ? s.totalCost / total : 0} color={typeColor(t)} height={4} />
            </div>
          ))}
        </Card>
        <Card title="By repo">
          {byRepo.length === 0 && <div className="empty-state">no data</div>}
          {byRepo.map(([repo, s]) => (
            <div key={repo} className="cost-breakdown-row">
              <div className="cbr-head">
                <span>{shortRepo(repo)}</span>
                <span className="dim">{fmtCost(s.total)} · {s.runs} runs</span>
              </div>
              <Progress value={total > 0 ? s.total / total : 0} color="var(--accent)" height={4} />
            </div>
          ))}
        </Card>
      </div>

      <Card title="Top 10 most expensive runs" pad={false}>
        <table className="activity">
          <tbody>
            {topCosts.map((a, i) => (
              <tr key={`${a.identifier}:${a.timestamp}`} className={i === 0 ? "" : ""}>
                <td><a href={`/dashboard/${encodeURIComponent(a.identifier)}`} className="id">{a.identifier}</a></td>
                <td>{a.title ?? "—"}</td>
                <td><Pill color={typeColor(a.critterType)}>{a.critterType}</Pill></td>
                <td className="repo">{shortRepo(a.repo)}</td>
                <td className="dur num">{fmtDuration(a.duration)}</td>
                <td className="cost num">{fmtCost(a.costUsd)}</td>
                <td className="when num">{fmtAgo(a.timestamp)}</td>
              </tr>
            ))}
            {topCosts.length === 0 && (
              <tr><td colSpan={7} className="empty-state">no cost data</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
