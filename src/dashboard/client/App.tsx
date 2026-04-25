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
import { checkAuth, fetchDashboard, rememberAuthToken } from "./lib/api.js";
import { usePoll } from "./lib/usePoll.js";
import { useRoute } from "./lib/useRoute.js";
import { CostsPage } from "./pages/CostsPage.js";
import { CritterTypesPage } from "./pages/CritterTypesPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { HooksPage } from "./pages/HooksPage.js";
import { InFlightPage } from "./pages/InFlightPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { QueuePage } from "./pages/QueuePage.js";
import { ReleasesPage } from "./pages/ReleasesPage.js";
import { ReposPage } from "./pages/ReposPage.js";
import { TokensPage } from "./pages/TokensPage.js";

const REFRESH_INTERVAL_SEC = 10;

export function App() {
  const typeFilter = window.__CRITTERS__?.typeFilter ?? null;
  const parsed = useRoute();
  const [createOpen, setCreateOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_SEC);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("critters-sidebar-collapsed") === "1");
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      localStorage.setItem("critters-sidebar-collapsed", c ? "0" : "1");
      return !c;
    });
  }, []);

  const paused = createOpen;
  const fetcher = useCallback((signal: AbortSignal) => fetchDashboard(typeFilter, signal), [typeFilter]);
  const { data, error, loading, refresh } = usePoll(fetcher, REFRESH_INTERVAL_SEC * 1000, [], paused);

  useEffect(() => {
    let live = true;
    checkAuth().then((required) => {
      if (!live) return;
      const storedToken = localStorage.getItem("critters-token");
      if (required && storedToken) {
        rememberAuthToken(storedToken);
      } else if (required) {
        setAuthRequired(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

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

  // Deep link to a specific identifier: show just the LogPage (no sidebar sub-nav churn).
  if (parsed.route === "logs" && parsed.identifier) {
    return (
      <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        {data && <Sidebar data={data} route={parsed.route} />}
        <main className="main" style={data ? undefined : { gridColumn: "1 / -1" }}>
          <LogPage identifier={parsed.identifier} />
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

  const renderPage = (): React.ReactNode => {
    switch (parsed.route) {
      case "dashboard":
        return (
          <>
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
            <div className="insights-row">
              <ThroughputCard data={data} />
              <TypeBreakdownCard data={data} />
            </div>
            <div className="lower-grid">
              <ActivityTable data={data} />
            </div>
          </>
        );
      case "inflight":
        return <InFlightPage data={data} />;
      case "queue":
        return <QueuePage data={data} onRefresh={refresh} />;
      case "history":
        return <HistoryPage data={data} />;
      case "logs":
        return <LogsPage data={data} />;
      case "types":
        return <CritterTypesPage />;
      case "repos":
        return <ReposPage />;
      case "hooks":
        return <HooksPage />;
      case "tokens":
        return <TokensPage />;
      case "costs":
        return <CostsPage data={data} />;
      case "models":
        return <ModelsPage />;
      case "releases":
        return <ReleasesPage />;
    }
  };

  return (
    <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar data={data} route={parsed.route} />
      <main className="main">
        <Topbar
          route={parsed.route}
          typeFilter={typeFilter}
          countdown={countdown}
          onOpenCreate={() => setCreateOpen(true)}
          onRefreshNow={refresh}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />
        <div className="content">
          {authRequired && <AuthPrompt onSaved={() => setAuthRequired(false)} />}
          {renderPage()}
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
