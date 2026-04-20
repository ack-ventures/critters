import type { ActiveCritterDetail } from "../../../types.js";
import type { DashboardData } from "../../dashboard-data.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill, Progress } from "../components/primitives.js";
import { fmtCost, fmtDurationShort, phaseLabel, shortRepo, typeColor } from "../lib/format.js";
import { useTick } from "../lib/useTick.js";

interface Props {
  data: DashboardData;
}

export function InFlightPage({ data }: Props) {
  useTick(1000);
  return (
    <>
      <PageHeader
        title="In flight"
        subtitle={`${data.activeCritters.length} active · ${data.concurrency.active}/${data.concurrency.max} slots used`}
        right={data.activeCritters.length > 0 && <Pill><Dot color="var(--accent)" pulse /> live</Pill>}
      />
      {data.activeCritters.length === 0 ? (
        <div className="empty-state">
          <span className="icon">&#x1F997;</span>
          No active critters — all quiet
        </div>
      ) : (
        <div className="flight-grid">
          {data.activeCritters.map((c) => <FlightCard key={c.identifier} c={c} />)}
        </div>
      )}
    </>
  );
}

function FlightCard({ c }: { c: ActiveCritterDetail }) {
  const elapsed = Date.now() - c.startedAt;
  const timeoutMs = (c.timeoutMinutes ?? 30) * 60 * 1000;
  const pct = Math.min(1, elapsed / timeoutMs);
  const danger = pct > 0.8;
  const type = c.critterType ?? "create";
  const color = typeColor(type);
  const logHref = `/dashboard/${encodeURIComponent(c.identifier)}`;
  return (
    <div className="flight-card">
      <div className="fc-head">
        <Dot color={color} pulse />
        <a href={logHref} className="fc-id">{c.identifier}</a>
        <Pill color={color} borderColor={`color-mix(in oklch, ${color} 35%, transparent)`}>{phaseLabel(c.phase)}</Pill>
        <span className="spacer" />
        <Pill>{type}</Pill>
      </div>
      <div className="fc-title">{c.title}</div>
      <div className="fc-meta">
        <span>{shortRepo(c.repo)}</span>
        <span>·</span>
        <span>{c.branch}</span>
      </div>
      <div className="fc-metrics">
        <Metric label="elapsed" value={fmtDurationShort(elapsed)} danger={danger} />
        <Metric
          label="cost"
          value={fmtCost(c.costUsd)}
          sub={c.costBudget != null ? `/ $${c.costBudget.toFixed(0)}` : undefined}
        />
        <Metric label="timeout" value={`${c.timeoutMinutes ?? 30}m`} />
      </div>
      <div className="fc-progress">
        <Progress value={pct} color={danger ? "var(--danger)" : color} height={3} />
      </div>
      <div className="fc-actions">
        {c.prUrl && <a href={c.prUrl} target="_blank" rel="noreferrer" className="fc-link">open PR &#x2197;</a>}
        <a href={logHref} className="fc-link">view logs &#x2197;</a>
        <span className="spacer" />
      </div>
    </div>
  );
}

function Metric({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div>
      <div className="fc-metric-label">{label}</div>
      <div className={`fc-metric-value${danger ? " danger" : ""}`}>
        {value} {sub && <span className="fc-metric-sub">{sub}</span>}
      </div>
    </div>
  );
}
