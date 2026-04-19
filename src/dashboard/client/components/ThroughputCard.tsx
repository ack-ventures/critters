import type { DashboardData } from "../../dashboard-data.js";

interface ThroughputCardProps {
  data: DashboardData;
}

export function ThroughputCard({ data }: ThroughputCardProps) {
  const { daily } = data;
  const max = Math.max(1, ...daily.map((d) => d.completed + d.failed));

  return (
    <div className="card">
      <div className="body">
        <div className="chart-head">
          <h3>Throughput</h3>
          <span className="meta">tasks / day · 14d</span>
        </div>
        <div className="throughput-bars">
          {daily.map((d) => {
            const total = d.completed + d.failed;
            const totalH = (total / max) * 100;
            const failH = (d.failed / max) * 100;
            const okH = Math.max(0, totalH - failH);
            return (
              <div key={d.date} className="bar-col" title={`${d.date} · ${d.completed} ok / ${d.failed} fail`}>
                <div className="ok" style={{ height: `${okH.toFixed(1)}px` }} />
                <div className="bad" style={{ height: `${failH.toFixed(1)}px` }} />
              </div>
            );
          })}
        </div>
        <div className="throughput-axis">
          <span>{daily[0]?.date.slice(5) ?? ""}</span>
          <span>{daily[daily.length - 1]?.date.slice(5) ?? ""}</span>
        </div>
      </div>
    </div>
  );
}
