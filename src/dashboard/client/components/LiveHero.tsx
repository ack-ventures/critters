import { useEffect, useState } from "react";
import type { DashboardData } from "../../dashboard-data.js";
import { ActiveList } from "./ActiveList.js";
import { LiveTail } from "./LiveTail.js";
import { Dot, Pill } from "./primitives.js";

interface LiveHeroProps {
  data: DashboardData;
}

export function LiveHero({ data }: LiveHeroProps) {
  const [selectedId, setSelectedId] = useState<string | null>(data.activeCritters[0]?.identifier ?? null);

  // If the selected critter completes between polls, re-anchor to the first active one.
  useEffect(() => {
    const stillActive = data.activeCritters.some((c) => c.identifier === selectedId);
    if (!stillActive) setSelectedId(data.activeCritters[0]?.identifier ?? null);
  }, [data.activeCritters, selectedId]);

  const selected = data.activeCritters.find((c) => c.identifier === selectedId) ?? null;

  return (
    <div className="live-hero" id="active-section">
      <div className="active-col">
        <div className="section-header">
          <h3>Active</h3>
          <span className="count">{data.activeCritters.length}</span>
          <span className="spacer" />
          {data.activeCritters.length > 0 && (
            <Pill><Dot color="var(--accent)" pulse /> live</Pill>
          )}
        </div>
        <div className="active-scroll">
          <ActiveList
            active={data.activeCritters}
            queued={data.queuedCritters}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>
      <div className="tail-col">
        <LiveTail critter={selected} />
      </div>
    </div>
  );
}
