import type { DashboardData } from "../../dashboard-data.js";
import { fmtAgo } from "../lib/format.js";
import { useTick } from "../lib/useTick.js";
import { Dot } from "./primitives.js";

interface SidebarProps {
  data: DashboardData;
}

export function Sidebar({ data }: SidebarProps) {
  useTick(5000);
  const uptimeStr = fmtDurationAbs(data.uptimeMs);

  return (
    <aside className="sidebar">
      <div className="brand">
        <CritterGlyph />
        critters
        <span className="ver">{data.version}</span>
      </div>

      <nav className="nav-group">
        <div className="label">Monitor</div>
        <a className="nav-item active" href="#top">
          <Dot color="var(--accent)" pulse /> Dashboard
        </a>
        <a className="nav-item" href="#active-section">
          In flight <span className="count">{data.activeCritters.length}</span>
        </a>
        <a className="nav-item" href="#active-section">
          Queue <span className="count">{data.queuedCritters.length}</span>
        </a>
        <a className="nav-item" href="#activity-section">
          History
        </a>
      </nav>

      <nav className="nav-group">
        <div className="label">Insights</div>
        <a className="nav-item" href="/dashboard/release-notes">
          Release notes
        </a>
      </nav>

      <div className="daemon-card">
        <div className="row">
          <span className="l">status</span>
          <span style={{ color: "var(--green)" }}>
            <Dot color="var(--green)" /> healthy
          </span>
        </div>
        <div className="row">
          <span className="l">uptime</span>
          <span>{uptimeStr}</span>
        </div>
        <div className="row">
          <span className="l">poll</span>
          <span>every {data.pollIntervalSeconds}s</span>
        </div>
        <div className="row">
          <span className="l">last</span>
          <span>{fmtAgo(data.lastPollAt)}</span>
        </div>
        <div className="row">
          <span className="l">slots</span>
          <span>
            {data.concurrency.active}/{data.concurrency.max}
          </span>
        </div>
      </div>
    </aside>
  );
}

function CritterGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="11" r="5" fill="var(--accent)" opacity="0.95" />
      <circle cx="10" cy="6" r="2.2" fill="var(--accent)" />
      <line x1="8.5" y1="4.5" x2="6" y2="2.5" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="11.5" y1="4.5" x2="14" y2="2.5" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4" y1="10" x2="1.5" y2="9" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="16" y1="10" x2="18.5" y2="9" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4.5" y1="13" x2="2" y2="15" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="15.5" y1="13" x2="18" y2="15" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function fmtDurationAbs(ms: number): string {
  if (ms < 0) return "\u2014";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
