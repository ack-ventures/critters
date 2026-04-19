import type { DashboardData } from "../../dashboard-data.js";
import { typeColor } from "../lib/format.js";
import { Dot, Progress } from "./primitives.js";

interface TypeBreakdownCardProps {
  data: DashboardData;
}

export function TypeBreakdownCard({ data }: TypeBreakdownCardProps) {
  const entries = Object.entries(data.typeStats).sort((a, b) => b[1].total - a[1].total);
  if (entries.length === 0) return null;

  return (
    <div className="card">
      <div className="body">
        <div className="chart-head"><h3>By type</h3></div>
        <div className="type-rows">
          {entries.map(([type, s]) => {
            const rate = s.total > 0 ? Math.round((s.succeeded / s.total) * 100) : 0;
            const color = typeColor(type);
            return (
              <div className="type-row" key={type}>
                <Dot color={color} size={8} />
                <span className="name">{type}</span>
                <span className="track"><Progress value={rate / 100} color={color} height={4} /></span>
                <span className="rate">{rate}%</span>
                <span className="total">{s.total}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
