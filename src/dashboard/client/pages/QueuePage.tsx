import { useState } from "react";
import type { DashboardData } from "../../dashboard-data.js";
import { PageHeader } from "../components/PageHeader.js";
import { Pill } from "../components/primitives.js";
import { triggerPoll } from "../lib/api.js";
import { fmtAgoShort, shortRepo, typeColor } from "../lib/format.js";
import { useTick } from "../lib/useTick.js";

interface Props {
  data: DashboardData;
  onRefresh: () => void;
}

export function QueuePage({ data, onRefresh }: Props) {
  useTick(1000);
  const [polling, setPolling] = useState(false);
  const poll = Math.max(0, data.pollIntervalSeconds - Math.floor((Date.now() - (data.lastPollAt ? new Date(data.lastPollAt).getTime() : Date.now())) / 1000));

  async function doPoll() {
    setPolling(true);
    try {
      await triggerPoll();
      onRefresh();
    } finally {
      setTimeout(() => setPolling(false), 800);
    }
  }

  return (
    <>
      <PageHeader
        title="Queue"
        subtitle={`${data.queuedCritters.length} waiting · polls every ${data.pollIntervalSeconds}s`}
        right={<button type="button" className="btn-primary" onClick={doPoll} disabled={polling}>{polling ? "Polling…" : "Poll now"}</button>}
      />
      <div className="queue-card">
        <div className="queue-head">
          <span>#</span>
          <span>Issue</span>
          <span>Title</span>
          <span>Type</span>
          <span>Repo</span>
          <span>Waiting</span>
        </div>
        {data.queuedCritters.length === 0 ? (
          <div className="empty-state">queue is empty</div>
        ) : data.queuedCritters.map((q, i) => (
          <div key={q.identifier} className="queue-row">
            <span className="qrw-n">{i + 1}</span>
            <a href={`/dashboard/${encodeURIComponent(q.identifier)}`} className="qrw-id">{q.identifier}</a>
            <span className="qrw-title">{q.title}</span>
            <span><Pill color={typeColor(q.critterType ?? "create")}>{q.critterType ?? "create"}</Pill></span>
            <span className="qrw-repo">{shortRepo(q.repo ?? "")}</span>
            <span className="qrw-wait">{fmtAgoShort(q.enqueuedAt)}</span>
          </div>
        ))}
      </div>
      <div className="queue-footer">
        Next poll in <span className="val">{poll}s</span> · trigger early with <span className="val">POST /poll</span> or the button above
      </div>
    </>
  );
}
