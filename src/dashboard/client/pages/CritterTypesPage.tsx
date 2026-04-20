import { useEffect, useState } from "react";
import { Card, KV } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { Dot, Pill } from "../components/primitives.js";
import { fetchTypes, type TypeEntry } from "../lib/api.js";
import { fmtCost, fmtDuration, typeColor } from "../lib/format.js";

export function CritterTypesPage() {
  const [types, setTypes] = useState<TypeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    fetchTypes().then((r) => {
      setTypes(r.types);
      setSel(r.types[0]?.name ?? null);
    }).catch(e => setError(e.message));
  }, []);

  if (error) return <div className="app-error">Failed to load types: {error}</div>;
  if (!types) return <div className="app-loading">Loading…</div>;

  const t = types.find(x => x.name === sel) ?? types[0];

  return (
    <>
      <PageHeader
        title="Critter types"
        subtitle={`${types.length} configured · ${types.filter(x => x.enabled).length} enabled`}
      />
      {types.length === 0 ? (
        <div className="empty-state">No critter types configured</div>
      ) : (
        <div className="types-split">
          <aside className="types-list">
            {types.map(tt => (
              <button
                key={tt.name}
                type="button"
                className={`types-list-row${tt.name === sel ? " selected" : ""}`}
                style={{ borderLeftColor: tt.name === sel ? typeColor(tt.name) : "transparent" }}
                onClick={() => setSel(tt.name)}
              >
                <div className="tlr-head">
                  <Dot color={typeColor(tt.name)} />
                  <span className="tlr-name">{tt.name}</span>
                  {tt.builtin && <Pill>built-in</Pill>}
                  <span className="spacer" />
                  <span className={`tlr-state ${tt.enabled ? "on" : "off"}`}>{tt.enabled ? "on" : "off"}</span>
                </div>
                <div className="tlr-sub">
                  {tt.phases.length} phase{tt.phases.length > 1 ? "s" : ""} · {tt.stats.total} runs
                </div>
              </button>
            ))}
          </aside>
          <section className="types-detail">
            {t && <TypeDetail t={t} />}
          </section>
        </div>
      )}
    </>
  );
}

function TypeDetail({ t }: { t: TypeEntry }) {
  return (
    <>
      <Card
        title={<span>{t.name} <span className="type-variant">· {t.builtin ? "built-in" : "custom"}</span></span>}
      >
        <div className="kv-grid-4">
          <KV k="trigger label" v={t.trigger.label} />
          <KV k="trigger status" v={t.trigger.status} />
          <KV k="provider" v={t.provider.join(", ") || "—"} />
          <KV k="concurrency" v={t.concurrency} />
          <KV k="timeout" v={`${t.timeoutMinutes}m`} />
          <KV k="claim status" v={t.claimStatus ?? "—"} />
          <KV k="on success →" v={t.outcomes.success?.status ?? "—"} />
          <KV k="on failure →" v={t.outcomes.failure?.status ?? "—"} />
        </div>
      </Card>

      <Card title="Phase pipeline">
        <div className="phase-pipeline">
          {t.phases.map((p, i) => (
            <div key={p.name} className="phase-step-wrap">
              <div className="phase-step">
                <div className="phase-step-n">phase {i + 1}</div>
                <div className="phase-step-name">{p.name}</div>
                <div className="kv-grid-2">
                  <KV k="cli" v={p.cli} />
                  <KV k="model" v={p.model} />
                  <KV k="maxTurns" v={p.maxTurns} />
                  <KV k="tools" v={p.tools} />
                  <div className="span-2">
                    <KV k="prompt" v={<code>{p.prompt}</code>} />
                  </div>
                  {p.permissionMode && <KV k="perm mode" v={p.permissionMode} />}
                  {p.sandbox && <KV k="sandbox" v={p.sandbox} />}
                </div>
              </div>
              {i < t.phases.length - 1 && <div className="phase-arrow">→</div>}
            </div>
          ))}
        </div>
      </Card>

      <div className="type-stat-grid">
        <Card><div className="stat-big">{t.stats.total}</div><div className="stat-label">Runs</div></Card>
        <Card>
          <div className="stat-big ok">
            {t.stats.total > 0 ? `${Math.round((t.stats.succeeded / t.stats.total) * 100)}%` : "—"}
          </div>
          <div className="stat-label">Success</div>
        </Card>
        <Card><div className="stat-big">{fmtCost(t.stats.avgCost)}</div><div className="stat-label">Avg cost</div></Card>
        <Card><div className="stat-big">{fmtDuration(t.stats.avgDuration)}</div><div className="stat-label">Avg duration</div></Card>
      </div>
    </>
  );
}
