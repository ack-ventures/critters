import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot } from "../components/primitives.js";
import { type EnvStatusResponse, fetchEnvStatus } from "../lib/api.js";

export function TokensPage() {
  const [data, setData] = useState<EnvStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEnvStatus().then(setData).catch(e => setError(e.message));
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, EnvStatusResponse["envVars"]>();
    for (const v of data?.envVars ?? []) {
      const bucket = m.get(v.category) ?? [];
      if (bucket.length === 0) m.set(v.category, bucket);
      bucket.push(v);
    }
    return m;
  }, [data]);

  if (error) return <div className="app-error">Failed: {error}</div>;
  if (!data) return <div className="app-loading">Loading…</div>;

  const total = data.envVars.length;
  const setCount = data.envVars.filter(v => v.set).length;

  return (
    <>
      <PageHeader
        title="Tokens & secrets"
        subtitle="Environment variable presence · values are never exposed"
      />
      <Card
        title=".env status"
        right={<span className="card-head-count">{setCount}/{total} set</span>}
        pad={false}
      >
        {[...grouped.entries()].map(([cat, vars]) => (
          <div key={cat} className="env-group">
            <div className="env-group-label">{cat}</div>
            {vars.map((v) => (
              <div key={v.key} className="env-row">
                <Dot color={v.set ? "var(--green)" : "var(--fg-3)"} />
                <span className="env-key">{v.key}</span>
                <span className="spacer" />
                <span className={`env-status ${v.set ? "set" : "unset"}`}>
                  {v.set ? "••••••" : "—"}
                </span>
              </div>
            ))}
          </div>
        ))}
      </Card>
    </>
  );
}
