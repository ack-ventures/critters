import { useState } from "react";
import { triggerPoll } from "../lib/api.js";
import type { RouteKey } from "../lib/routes.js";
import { NotificationsButton } from "./NotificationsButton.js";

interface TopbarProps {
  route: RouteKey;
  typeFilter: string | null;
  countdown: number;
  onOpenCreate: () => void;
  onRefreshNow: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const TITLES: Record<RouteKey, string> = {
  dashboard: "Console",
  inflight: "In flight",
  queue: "Queue",
  history: "History",
  logs: "Logs",
  types: "Critter types",
  repos: "Repos",
  hooks: "Hooks & webhooks",
  tokens: "Tokens",
  costs: "Costs",
  models: "Models",
  releases: "Release notes",
};

export function Topbar({ route, typeFilter, countdown, onOpenCreate, onRefreshNow, sidebarCollapsed, onToggleSidebar }: TopbarProps) {
  const [polling, setPolling] = useState(false);
  const [pollLabel, setPollLabel] = useState("Poll now");

  async function handlePoll() {
    setPolling(true);
    setPollLabel("Polling\u2026");
    try {
      await triggerPoll();
      setPollLabel("Triggered");
      onRefreshNow();
    } catch {
      setPollLabel("Failed");
    }
    setTimeout(() => {
      setPollLabel("Poll now");
      setPolling(false);
    }, 1500);
  }

  return (
    <div className="topbar" id="top">
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
      >
        {sidebarCollapsed ? "\u2630" : "\u00AB"}
      </button>
      <h1>{TITLES[route]}</h1>
      <span className="breadcrumb">
        &middot; critters daemon
        {typeFilter ? ` \u00B7 type: ${typeFilter}` : ""}
      </span>
      <span className="spacer" />
      <span className="meta">Refreshing in {countdown}s</span>
      <button type="button" className="btn" onClick={handlePoll} disabled={polling}>
        {pollLabel}
      </button>
      <button type="button" className="btn primary" onClick={onOpenCreate}>
        + New critter
      </button>
      <NotificationsButton />
    </div>
  );
}
