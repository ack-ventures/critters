import { useState } from "react";
import { triggerPoll } from "../lib/api.js";
import { NotificationsButton } from "./NotificationsButton.js";

interface TopbarProps {
  typeFilter: string | null;
  countdown: number;
  onOpenCreate: () => void;
  onRefreshNow: () => void;
}

export function Topbar({ typeFilter, countdown, onOpenCreate, onRefreshNow }: TopbarProps) {
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
      <h1>Console</h1>
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
