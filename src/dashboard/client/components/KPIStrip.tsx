import type { DashboardData } from "../../dashboard-data.js";
import { fmtCost, fmtDuration } from "../lib/format.js";
import { Dot, Sparkline } from "./primitives.js";

interface KPIStripProps {
  data: DashboardData;
}

export function KPIStrip({ data }: KPIStripProps) {
  const last7 = data.daily.slice(-7);
  const sparkTasks = last7.map((d) => d.completed + d.failed);
  const sparkCost = last7.map((d) => Math.round(d.cost * 100) / 100);

  const { totals } = data;

  return (
    <div className="kpi-strip">
      <Kpi label={<><Dot color="var(--accent)" pulse /> In flight</>}
           value={String(data.activeCritters.length)}
           sub={`${data.queuedCritters.length} queued`} />
      <Kpi label="Success · 14d"
           value={totals.successRate != null ? `${totals.successRate}%` : "N/A"}
           sub={`${totals.succeeded}/${totals.totalTasks} tasks`}
           spark={sparkTasks} />
      <Kpi label="Spend · 14d"
           value={fmtCost(totals.totalCost)}
           sub={totals.avgCost != null ? `avg ${fmtCost(totals.avgCost)}/run` : "no runs"}
           spark={sparkCost} />
      <Kpi label="Avg duration"
           value={fmtDuration(totals.avgDuration)}
           sub="planning + execution" />
    </div>
  );
}

interface KpiProps {
  label: React.ReactNode;
  value: string;
  sub: string;
  spark?: number[];
}

function Kpi({ label, value, sub, spark }: KpiProps) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value-row">
        <div className="value">{value}</div>
        {spark && spark.length > 0 && (
          <div className="spark">
            <Sparkline data={spark} />
          </div>
        )}
      </div>
      <div className="sub">{sub}</div>
    </div>
  );
}
