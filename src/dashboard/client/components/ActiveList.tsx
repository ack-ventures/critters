import type { ActiveCritterDetail, QueuedCritterDetail } from "../../../types.js";
import { fmtAgoShort, fmtCost, fmtDurationShort, phaseLabel, typeColor } from "../lib/format.js";
import { useTick } from "../lib/useTick.js";
import { Dot, Pill, Progress } from "./primitives.js";

interface ActiveListProps {
  active: ActiveCritterDetail[];
  queued: QueuedCritterDetail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ActiveList({ active, queued, selectedId, onSelect }: ActiveListProps) {
  useTick(1000);

  if (active.length === 0 && queued.length === 0) {
    return (
      <div className="empty-state">
        <span className="icon">&#x1F997;</span>
        No active critters — all quiet
      </div>
    );
  }

  return (
    <>
      {active.map((c) => (
        <ActiveRow
          key={c.identifier}
          critter={c}
          active={c.identifier === selectedId}
          onClick={() => onSelect(c.identifier)}
        />
      ))}
      {queued.length > 0 && (
        <>
          <div className="queued-header">Queued · {queued.length}</div>
          {queued.map((q) => (
            <div key={q.identifier} className="queued-row">
              <Dot color="var(--fg-3)" />
              <span className="qr-id">{q.identifier}</span>
              <span className="qr-title">{q.title}</span>
              <span className="qr-wait">{fmtAgoShort(q.enqueuedAt)}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

interface ActiveRowProps {
  critter: ActiveCritterDetail;
  active: boolean;
  onClick: () => void;
}

function ActiveRow({ critter, active, onClick }: ActiveRowProps) {
  const elapsed = Date.now() - critter.startedAt;
  const timeoutMs = (critter.timeoutMinutes ?? 30) * 60 * 1000;
  const pct = Math.min(1, elapsed / timeoutMs);
  const danger = pct > 0.8;
  const type = critter.critterType ?? "create";
  const color = typeColor(type);
  const cost = critter.costUsd != null
    ? critter.costBudget
      ? `${fmtCost(critter.costUsd)} / ${fmtCost(critter.costBudget)}`
      : fmtCost(critter.costUsd)
    : "";

  return (
    <button
      type="button"
      className={`active-row${active ? " selected" : ""}`}
      style={{ borderLeftColor: active ? color : "transparent" }}
      onClick={onClick}
    >
      <div className="ar-head">
        <Dot color={color} pulse />
        <span className="ar-id">{critter.identifier}</span>
        <span style={{ flex: 1 }} />
        <span className={`ar-elapsed${danger ? " danger" : ""}`}>{fmtDurationShort(elapsed)}</span>
      </div>
      <div className="ar-title">{critter.title}</div>
      <div className="ar-meta">
        <Pill color={color} borderColor={`color-mix(in oklch, ${color} 35%, transparent)`}>
          {phaseLabel(critter.phase)}
        </Pill>
        <Pill>{type}</Pill>
        <span className="ar-cost">{cost}</span>
      </div>
      <Progress value={pct} color={danger ? "var(--danger)" : color} height={2} />
    </button>
  );
}
