import { useCallback, useEffect, useState } from "react";
import { ActivityTable } from "./components/ActivityTable.js";
import { AuthPrompt } from "./components/AuthPrompt.js";
import { CreateModal } from "./components/CreateModal.js";
import { KPIStrip } from "./components/KPIStrip.js";
import { LiveHero } from "./components/LiveHero.js";
import { LogPage } from "./components/LogPage.js";
import { Sidebar } from "./components/Sidebar.js";
import { ThroughputCard } from "./components/ThroughputCard.js";
import { Topbar } from "./components/Topbar.js";
import { TypeBreakdownCard } from "./components/TypeBreakdownCard.js";
import { checkAuth, fetchDashboard } from "./lib/api.js";
import { usePoll } from "./lib/usePoll.js";

const REFRESH_INTERVAL_SEC = 10;

export function App() {
  const typeFilter = window.__CRITTERS__?.typeFilter ?? null;
  const identifier = window.__CRITTERS__?.identifier
    ?? (() => {
      const m = window.location.pathname.match(/^\/dashboard\/(.+)/);
      return m ? decodeURIComponent(m[1]) : null;
    })();
  const [createOpen, setCreateOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_SEC);

  const paused = createOpen;
  const fetcher = useCallback((signal: AbortSignal) => fetchDashboard(typeFilter, signal), [typeFilter]);
  const { data, error, loading, refresh } = usePoll(fetcher, REFRESH_INTERVAL_SEC * 1000, [], paused);

  useEffect(() => {
    let live = true;
    checkAuth().then((required) => {
      if (!live) return;
      if (required && !window.__CRITTERS__?.token && !localStorage.getItem("critters-token")) {
        setAuthRequired(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Reset the countdown whenever a fresh payload arrives (identity swap).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is the trigger — the effect doesn't read it.
  useEffect(() => {
    setCountdown(REFRESH_INTERVAL_SEC);
  }, [data]);

  useEffect(() => {
    const id = setInterval(() => {
      if (paused) return;
      setCountdown((c) => (c <= 1 ? REFRESH_INTERVAL_SEC : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [paused]);

  if (identifier) {
    return (
      <div className="app">
        {data && <Sidebar data={data} />}
        <main className="main" style={data ? undefined : { gridColumn: "1 / -1" }}>
          <LogPage identifier={identifier} />
        </main>
      </div>
    );
  }

  if (loading && !data) {
    return <div className="app-loading">Loading dashboard…</div>;
  }
  if (error && !data) {
    return <div className="app-error">Failed to load dashboard: {error.message}</div>;
  }
  if (!data) return null;

  return (
    <div className="app">
      <Sidebar data={data} />
      <main className="main">
        <Topbar
          typeFilter={typeFilter}
          countdown={countdown}
          onOpenCreate={() => setCreateOpen(true)}
          onRefreshNow={refresh}
        />
        <div className="content">
          {authRequired && <AuthPrompt onSaved={() => setAuthRequired(false)} />}
          {data.allTypes.length >= 2 && (
            <div className="type-filters">
              <a href="/dashboard" className={`chip${!typeFilter ? " active" : ""}`}>all</a>
              {data.allTypes.map((t) => (
                <a
                  key={t}
                  href={`/dashboard?type=${encodeURIComponent(t)}`}
                  className={`chip${typeFilter === t ? " active" : ""}`}
                >
                  {t}
                </a>
              ))}
            </div>
          )}
          <KPIStrip data={data} />
          <LiveHero data={data} />
          <div className="lower-grid">
            <ActivityTable data={data} />
            <div className="side-col">
              <ThroughputCard data={data} />
              <TypeBreakdownCard data={data} />
            </div>
          </div>
        </div>
      </main>
      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onAuthRequired={() => {
          setCreateOpen(false);
          setAuthRequired(true);
        }}
      />
    </div>
  );
}
