import { useEffect, useState } from "react";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill } from "../components/primitives.js";
import { fetchModels, type ModelEntry } from "../lib/api.js";

function modelColor(m: ModelEntry): string {
  if (m.provider !== "anthropic") return "var(--violet)";
  if (m.name.includes("opus")) return "var(--accent)";
  if (m.name.includes("sonnet")) return "var(--sky)";
  return "var(--green)";
}

export function ModelsPage() {
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels().then(r => setModels(r.models)).catch(e => setError(e.message));
  }, []);

  if (error) return <div className="app-error">Failed: {error}</div>;
  if (!models) return <div className="app-loading">Loading…</div>;

  return (
    <>
      <PageHeader title="Models" subtitle="Which model runs which phase, pulled from your critter-type config" />
      <Card title="Models in use" pad>
        {models.length === 0 ? (
          <div className="empty-state">No models found in config</div>
        ) : (
          <div className="model-grid">
            {models.map((m) => (
              <div key={m.name} className="model-card">
                <div className="model-head">
                  <Dot color={modelColor(m)} />
                  <span className="model-name">{m.name}</span>
                  <Pill>{m.provider}</Pill>
                </div>
                <div className="model-usedby-label">Used by</div>
                <div className="model-usedby">
                  {m.usedBy.map(u => <Pill key={u}>{u}</Pill>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
