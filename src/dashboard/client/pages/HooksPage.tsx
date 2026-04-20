import { useEffect, useState } from "react";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill } from "../components/primitives.js";
import { fetchHooks, type HooksResponse } from "../lib/api.js";

export function HooksPage() {
  const [data, setData] = useState<HooksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHooks().then(setData).catch(e => setError(e.message));
  }, []);

  if (error) return <div className="app-error">Failed to load hooks: {error}</div>;
  if (!data) return <div className="app-loading">Loading…</div>;

  return (
    <>
      <PageHeader title="Hooks & webhooks" subtitle="Lifecycle hooks + inbound webhooks" />
      <div className="two-col">
        <Card
          title="Lifecycle hooks"
          right={
            <span className="card-head-count">
              {data.hooks.filter(h => h.enabled).length}/{data.hooks.length} enabled
            </span>
          }
          pad={false}
        >
          {data.hooks.map((h, i) => (
            <div key={h.event} className={`hook-row${i === data.hooks.length - 1 ? " last" : ""}`}>
              <div className="hook-row-head">
                <Dot color={h.enabled ? "var(--green)" : "var(--fg-3)"} />
                <span className="hook-event">{h.event}</span>
                <span className="spacer" />
              </div>
              <div className={`hook-cmd${h.cmd ? "" : " empty"}`}>
                {h.cmd || "(not configured)"}
              </div>
            </div>
          ))}
        </Card>

        <Card title="Inbound webhooks" pad={false}>
          {data.webhooks.map((w, i) => (
            <div key={w.provider} className={`hook-row${i === data.webhooks.length - 1 ? " last" : ""}`}>
              <div className="hook-row-head">
                <Dot color={w.secretSet ? "var(--green)" : "var(--fg-3)"} pulse={w.secretSet} />
                <span className="hook-event capitalize">{w.provider}</span>
                <Pill color={w.secretSet ? "var(--green)" : "var(--amber)"}>
                  {w.secretSet ? "secret set" : "no secret"}
                </Pill>
                <span className="spacer" />
              </div>
              <div className="hook-cmd">{w.endpoint}</div>
            </div>
          ))}
          {data.tunnel?.domain && (
            <div className="tunnel-band">
              Tunnel: <span className="val">{data.tunnel.domain}</span>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
