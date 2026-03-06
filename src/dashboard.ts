import type { HealthStatus } from "./health.js";
import { getRecentMetrics, type MetricEvent } from "./metrics.js";
import { getDisplayVersion } from "./updater.js";
import { formatDuration } from "./utils.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "\u2014";
  return formatDuration(ms);
}

function formatCost(cost: number | undefined): string {
  if (cost == null || Number.isNaN(cost)) return "\u2014";
  return `$${cost.toFixed(2)}`;
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toISOString().slice(0, 10);
  } catch {
    return "\u2014";
  }
}

function getDateKey(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "unknown";
  }
}

function formatShortDate(dateStr: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${months[monthIdx] ?? parts[1]} ${day}`;
}

function chartDateLabel(dateStr: string, prevDateStr: string | null): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parts[1];
  const monthIdx = parseInt(month, 10) - 1;

  // Show month name + day when month changes (or for the first label)
  if (prevDateStr == null) {
    return `${months[monthIdx] ?? month} ${day}`;
  }

  const prevParts = prevDateStr.split("-");
  if (prevParts.length >= 2 && prevParts[1] !== month) {
    return `${months[monthIdx] ?? month} ${day}`;
  }

  // Same month: just show the day number
  return `${day}`;
}

function formatDurationMinutes(ms: number): string {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  return `${mins}m`;
}

function formatCostLabel(v: number): string {
  if (Number.isInteger(v)) return `$${v}`;
  return `$${parseFloat(v.toFixed(2))}`;
}

type DayStat = { date: string; completed: number; failed: number; cost: number; avgDuration: number; perType: Record<string, { completed: number; failed: number }> };

function computeDailyStats(metrics: MetricEvent[], days: number): DayStat[] {
  const now = new Date();
  const dateMap = new Map<string, DayStat>();
  const durAccum = new Map<string, { totalDur: number; durCount: number }>();

  // Pre-fill last N days
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateMap.set(key, { date: key, completed: 0, failed: 0, cost: 0, avgDuration: 0, perType: {} });
    durAccum.set(key, { totalDur: 0, durCount: 0 });
  }

  for (const m of metrics) {
    if (m.event !== "task_completed" && m.event !== "task_failed" &&
        m.event !== "review_completed" && m.event !== "review_failed") continue;
    const key = getDateKey(m.timestamp);
    const stat = dateMap.get(key);
    if (!stat) continue;
    const isOk = m.event === "task_completed" || m.event === "review_completed";
    if (isOk) stat.completed++;
    else stat.failed++;
    stat.cost += m.costUsd ?? 0;
    const typeName = m.critterType ?? (m.event.startsWith("review_") ? "review" : "create");
    if (!stat.perType[typeName]) stat.perType[typeName] = { completed: 0, failed: 0 };
    if (isOk) stat.perType[typeName].completed++;
    else stat.perType[typeName].failed++;
    if (m.duration != null && !Number.isNaN(m.duration)) {
      const acc = durAccum.get(key);
      if (acc) {
        acc.totalDur += m.duration;
        acc.durCount++;
      }
    }
  }

  for (const [key, stat] of dateMap) {
    const acc = durAccum.get(key);
    stat.avgDuration = acc && acc.durCount > 0 ? acc.totalDur / acc.durCount : 0;
  }

  return Array.from(dateMap.values());
}

function niceMax(value: number, isCost: boolean): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = isCost
    ? [1, 2, 2.5, 3, 4, 5, 6, 7, 7.5, 8, 10]
    : [1, 2, 2.5, 5, 10];
  for (const n of steps) {
    const candidate = n * magnitude;
    if (candidate >= value) {
      if (isCost) return parseFloat(candidate.toFixed(2));
      return Math.round(candidate);
    }
  }
  return Math.ceil(value / magnitude) * magnitude;
}

function inferType(m: MetricEvent): string {
  return m.critterType ?? (m.event.startsWith("review_") ? "review" : "create");
}

export function renderDashboard(metricsPath: string, status: HealthStatus, uptime: number, typeFilter?: string): string {
  const allMetrics = getRecentMetrics(10000);

  // Extract unique types for filter buttons
  const allTypes = [...new Set(allMetrics.map(m => inferType(m)).filter(Boolean))].sort();

  // Apply type filter
  const filteredMetrics = typeFilter
    ? allMetrics.filter(m => inferType(m) === typeFilter)
    : allMetrics;

  const taskMetrics = filteredMetrics.filter(
    (m) => m.event === "task_completed" || m.event === "task_failed" ||
           m.event === "review_completed" || m.event === "review_failed",
  );

  // Summary stats
  const totalTasks = taskMetrics.length;
  const succeeded = taskMetrics.filter((m) => m.event === "task_completed" || m.event === "review_completed").length;
  const failed = totalTasks - succeeded;
  const successRate = totalTasks > 0 ? Math.round((succeeded / totalTasks) * 100) : null;
  const totalCost = taskMetrics.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  const avgCost = totalTasks > 0 ? totalCost / totalTasks : null;
  const durations = taskMetrics.map((m) => m.duration).filter((d): d is number => d != null && !Number.isNaN(d));
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Recent activity (last 50)
  const recentActivity = taskMetrics.slice(-50).reverse();

  // Chart data
  const dailyStats = computeDailyStats(filteredMetrics, 14);
  const rawMaxTasks = Math.max(1, ...dailyStats.map((d) => d.completed + d.failed));
  const maxTasksPerDay = niceMax(rawMaxTasks, false);
  const rawMaxCost = Math.max(0.01, ...dailyStats.map((d) => d.cost));
  const maxCostPerDay = niceMax(rawMaxCost, true);
  const rawMaxDuration = Math.max(0, ...dailyStats.map((d) => d.avgDuration));
  const maxDurationPerDay = niceMax(rawMaxDuration / 60000, false) * 60000;

  const todayStat = dailyStats[dailyStats.length - 1];
  const todayCompleted = todayStat?.completed ?? 0;
  const todayFailed = todayStat?.failed ?? 0;
  const todayCost = todayStat?.cost ?? 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30;url=${typeFilter ? `/dashboard?type=${encodeURIComponent(typeFilter)}` : `/dashboard`}">
  <title>Critters Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x1F41B;</text></svg>">
  <style>
    :root {
      --bg: #1a1a2e;
      --card-bg: #16213e;
      --accent: #0f3460;
      --success: #4ecca3;
      --failure: #e94560;
      --text: #eee;
      --text-dim: #8892a4;
      --border: #2a2a4a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      background: var(--bg);
      color: var(--text);
      padding: 20px;
      min-height: 100vh;
    }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; flex-wrap: wrap; gap: 8px; }
    .header-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .meta { color: var(--text-dim); font-size: 0.85rem; }
    .meta-sep { color: var(--text-dim); opacity: 0.3; }
    .card-blue { border-left: 3px solid #5dade2; }
    .card-green { border-left: 3px solid #4ecca3; }
    .card-gold { border-left: 3px solid #e2b93d; }
    .card-purple { border-left: 3px solid #8B5CF6; }
    .today-stats { margin-bottom: 24px; }
    .today-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .today-label {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.75rem;
      color: var(--text-dim);
      letter-spacing: 0.05em;
    }
    .today-value { color: var(--text); }
    .today-fail { color: var(--failure); }
    .today-sep { color: var(--text-dim); opacity: 0.4; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card .label { font-size: 0.8rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 1.8rem; font-weight: 700; margin-top: 4px; }
    .card .sub { font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }

    .charts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
    .chart-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .chart-card:hover { z-index: 10; position: relative; }
    .chart-card h3 { font-size: 0.9rem; margin-bottom: 12px; color: var(--text-dim); }
    .bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
    .bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; position: relative; }
    .bar-stack { display: flex; flex-direction: column-reverse; width: 100%; align-items: center; height: 100%; }
    .bar {
      width: 80%;
      min-width: 6px;
      border-radius: 2px 2px 0 0;
      transition: height 0.3s;
      position: relative;
    }
    .bar.success { background: var(--success); }
    .bar.failure { background: var(--failure); border-radius: 0; }
    .bar.cost { background: #e2b93d; }
    .bar.duration { background: #8B5CF6; }
    .donut-chart { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 120px; }
    .donut-svg { width: 100px; height: 100px; }
    .donut-text { font-family: inherit; font-size: 0.45rem; fill: var(--text); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
    .donut-legend { font-size: 0.75rem; color: var(--text-dim); margin-top: 8px; text-align: center; }
    .bar-label { font-size: 0.6rem; color: var(--text-dim); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      white-space: nowrap;
      pointer-events: none;
      z-index: 10;
    }
    .bar:hover { filter: brightness(1.2); }
    .bar-group[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      white-space: nowrap;
      pointer-events: none;
      z-index: 20;
    }
    .chart-with-axis { display: flex; align-items: stretch; }
    .y-axis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-end;
      padding-right: 6px;
      min-width: 40px;
      width: auto;
      flex-shrink: 0;
    }
    .y-axis .y-label { font-size: 0.65rem; color: var(--text-dim); line-height: 1; }
    .chart-with-axis .bar-chart { flex: 1; }

    .active-section { margin-bottom: 24px; }
    .active-section h2 { font-size: 1.1rem; margin-bottom: 12px; }
    .active-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .active-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; }
    .active-card .count { font-size: 1.5rem; font-weight: 700; }
    .active-card .label { font-size: 0.75rem; color: var(--text-dim); }

    .table-section { margin-bottom: 24px; }
    .table-section h2 { font-size: 1.1rem; margin-bottom: 12px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
    /* Status badge pills */
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-success {
      background: rgba(78, 204, 163, 0.15);
      color: var(--success);
    }
    .badge-failure {
      background: rgba(233, 69, 96, 0.15);
      color: var(--failure);
    }
    .badge-review {
      background: rgba(93, 173, 226, 0.15);
      color: #5dade2;
    }
    /* Phase badges */
    .badge-planning {
      background: rgba(93, 173, 226, 0.15);
      color: #5dade2;
    }
    .badge-execution {
      background: rgba(139, 92, 246, 0.15);
      color: #8B5CF6;
    }
    .badge-review-phase {
      background: rgba(226, 185, 61, 0.15);
      color: #e2b93d;
    }
    /* Elapsed time color coding */
    .elapsed-ok { color: var(--success); }
    .elapsed-warn { color: #e2b93d; }
    .elapsed-danger { color: var(--failure); }
    /* Row hover */
    tr:hover td { background: rgba(255,255,255,0.04); }
    /* Empty states */
    .empty-state {
      text-align: center;
      padding: 32px 16px;
      color: var(--text-dim);
      font-size: 0.9rem;
    }
    .empty-state-icon {
      font-size: 1.5rem;
      margin-bottom: 8px;
      display: block;
    }
    .type-filters {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .filter-btn {
      display: inline-block;
      padding: 4px 14px;
      border-radius: 16px;
      font-size: 0.8rem;
      font-weight: 600;
      border: 1px solid var(--border);
      color: var(--text-dim);
      text-decoration: none;
      transition: all 0.15s;
    }
    .filter-btn:hover {
      border-color: var(--text-dim);
      color: var(--text);
      text-decoration: none;
    }
    .filter-btn.active {
      background: #5dade2;
      border-color: #5dade2;
      color: #fff;
    }
    a { color: #5dade2; text-decoration: none; }
    a:hover { text-decoration: underline; }

    @media (max-width: 768px) {
      body { padding: 12px; }
      .summary { grid-template-columns: repeat(2, 1fr); gap: 10px; }
      .card .value { font-size: 1.4rem; }
      .charts { grid-template-columns: 1fr; }
      .bar-chart { gap: 2px; }
      .bar-group:nth-child(even) .bar-label { visibility: hidden; }
      .bar-label { transform: rotate(-45deg); transform-origin: top center; font-size: 0.55rem; }
      .y-axis { min-width: 35px; width: auto; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Critters Dashboard</h1>
    <div class="header-meta">
      <span class="meta">${escapeHtml(getDisplayVersion())}</span>
      <span class="meta-sep">|</span>
      <span class="meta">Uptime: ${fmtDuration(uptime)}</span>
      <span class="meta-sep">|</span>
      <span class="meta">Last poll: ${status.lastPollAt ? formatDate(status.lastPollAt) : "never"}</span>
    </div>
  </div>

${allTypes.length >= 2 ? `  <div class="type-filters">
    <a href="/dashboard" class="filter-btn${!typeFilter ? " active" : ""}">All</a>
${allTypes.map(t => `    <a href="/dashboard?type=${encodeURIComponent(t)}" class="filter-btn${typeFilter === t ? " active" : ""}">${escapeHtml(t)}</a>`).join("\n")}
  </div>` : ""}

  <div class="summary">
    <div class="card card-blue">
      <div class="label">Total Tasks</div>
      <div class="value">${totalTasks}</div>
      <div class="sub">${succeeded} succeeded, ${failed} failed</div>
    </div>
    <div class="card card-green">
      <div class="label">Success Rate</div>
      <div class="value">${successRate != null ? `${successRate}%` : "N/A"}</div>
    </div>
    <div class="card card-gold">
      <div class="label">Total Cost</div>
      <div class="value">${formatCost(totalCost)}</div>
    </div>
    <div class="card card-gold">
      <div class="label">Avg Cost</div>
      <div class="value">${avgCost != null && totalTasks > 0 ? formatCost(avgCost) : "N/A"}</div>
      <div class="sub">per critter</div>
    </div>
    <div class="card card-purple">
      <div class="label">Avg Duration</div>
      <div class="value">${avgDuration != null ? fmtDuration(avgDuration) : "N/A"}</div>
    </div>
  </div>

  <div class="today-stats">
    <div class="today-card">
      <span class="today-label">Today</span>
      <span class="today-value">${todayCompleted} completed</span>
      <span class="today-sep">|</span>
      <span class="today-value today-fail">${todayFailed} failed</span>
      <span class="today-sep">|</span>
      <span class="today-value">${formatCost(todayCost)} spent</span>
    </div>
  </div>

  <div class="active-section">
    <h2>Active Critters</h2>
${(() => {
  const allZero = Object.values(status.perType).every(c => c.active === 0 && c.queued === 0)
    && status.activeCritters === 0 && status.queuedCritters === 0;
  if (allZero) {
    return `    <div class="empty-state">
      <span class="empty-state-icon">&#x1F997;</span>
      No active critters &mdash; all quiet
    </div>`;
  }
  if (Object.keys(status.perType).length > 0) {
    return `    <div class="active-grid">
${Object.entries(status.perType)
      .map(([typeName, counts]) => {
        const label = escapeHtml(typeName);
        return `      <div class="active-card">
        <div class="count">${counts.active}</div>
        <div class="label">Active ${label}</div>
      </div>
      <div class="active-card">
        <div class="count">${counts.queued}</div>
        <div class="label">Queued ${label}</div>
      </div>`;
      })
      .join("\n")}
    </div>`;
  }
  return `    <div class="active-grid">
      <div class="active-card">
        <div class="count">${status.activeCritters}</div>
        <div class="label">Active Tasks</div>
      </div>
      <div class="active-card">
        <div class="count">${status.queuedCritters}</div>
        <div class="label">Queued Tasks</div>
      </div>
      <div class="active-card">
        <div class="count">${status.activeReviews}</div>
        <div class="label">Active Reviews</div>
      </div>
      <div class="active-card">
        <div class="count">${status.queuedReviews}</div>
        <div class="label">Queued Reviews</div>
      </div>
    </div>`;
})()}
${status.activeCritterDetails.length > 0 ? `
    <div class="table-wrap" style="margin-top: 12px;">
      <table>
        <thead>
          <tr>
            <th>Identifier</th>
            <th>Phase</th>
            <th>Repo</th>
            <th>Branch</th>
            <th>PR</th>
            <th>Elapsed</th>
          </tr>
        </thead>
        <tbody>
${status.activeCritterDetails.map((d) => {
  const elapsedMs = Date.now() - d.startedAt;
  const elapsed = fmtDuration(elapsedMs);
  const timeout = d.timeoutMinutes ?? 30;
  const timeoutMs = timeout * 60 * 1000;
  const elapsedPct = elapsedMs / timeoutMs;
  const elapsedClass = elapsedPct > 0.8 ? "elapsed-danger"
    : elapsedPct > 0.5 ? "elapsed-warn"
    : "elapsed-ok";
  const phaseLabel = d.phase === "plan" || d.phase === "planning" ? "Planning"
    : d.phase === "exec" || d.phase === "execution" ? "Execution"
    : d.phase === "review" ? "Review"
    : d.phase;
  const phaseBadgeClass = d.phase === "plan" || d.phase === "planning" ? "badge badge-planning"
    : d.phase === "exec" || d.phase === "execution" ? "badge badge-execution"
    : d.phase === "review" ? "badge badge-review-phase"
    : "badge";
  const prCell = d.prUrl
    ? `<a href="${escapeHtml(d.prUrl)}" target="_blank" rel="noopener">PR</a>`
    : "\u2014";
  return `          <tr>
            <td>${escapeHtml(d.identifier)}</td>
            <td><span class="${phaseBadgeClass}">${phaseLabel}</span></td>
            <td>${escapeHtml(d.repo)}</td>
            <td><code>${escapeHtml(d.branch)}</code></td>
            <td>${prCell}</td>
            <td class="${elapsedClass}">${elapsed}</td>
          </tr>`;
}).join("\n")}
        </tbody>
      </table>
    </div>` : ""}
  </div>

  <div class="charts">
    <div class="chart-card">
      <h3>Tasks per Day (Last 14 Days)</h3>
      <div class="chart-with-axis">
        <div class="y-axis">
          <span class="y-label">${maxTasksPerDay}</span>
          <span class="y-label">${Math.round(maxTasksPerDay / 2)}</span>
          <span class="y-label">0</span>
        </div>
        <div class="bar-chart">
${(() => {
  const typeColors: Record<string, string> = { create: "var(--success)", review: "#5dade2" };
  const extraColors = ["#8B5CF6", "#e2b93d", "#e9607a", "#3dd8e2", "#a3e23d"];
  let colorIdx = 0;
  const chartTypes = [...new Set(dailyStats.flatMap(d => Object.keys(d.perType)))].sort();
  for (const t of chartTypes) {
    if (!typeColors[t]) { typeColors[t] = extraColors[colorIdx % extraColors.length]; colorIdx++; }
  }
  return dailyStats
    .map((d, i) => {
      const shortDate = formatShortDate(d.date);
      const label = chartDateLabel(d.date, i > 0 ? dailyStats[i - 1].date : null);
      if (!typeFilter && chartTypes.length >= 2) {
        // Stacked bars per type
        const total = d.completed + d.failed;
        const bars = chartTypes.map(t => {
          const tc = d.perType[t];
          if (!tc) return "";
          const count = tc.completed + tc.failed;
          const h = Math.round((count / maxTasksPerDay) * 100);
          if (h === 0) return "";
          return `              <div class="bar" style="height:${h}%;background:${typeColors[t]};border-radius:0" data-tooltip="${t}: ${count}"></div>`;
        }).filter(Boolean).join("\n");
        return `          <div class="bar-group" data-tooltip="${shortDate}: ${total} tasks (${chartTypes.map(t => `${t}: ${(d.perType[t]?.completed ?? 0) + (d.perType[t]?.failed ?? 0)}`).join(", ")})">
            <div class="bar-stack">
${bars}
            </div>
            <div class="bar-label">${escapeHtml(label)}</div>
          </div>`;
      }
      // Single type or filtered: success/failure bars
      const successH = Math.round(((d.completed) / maxTasksPerDay) * 100);
      const failH = Math.round(((d.failed) / maxTasksPerDay) * 100);
      return `          <div class="bar-group" data-tooltip="${shortDate}: ${d.completed} completed, ${d.failed} failed">
            <div class="bar-stack">
              <div class="bar failure" style="height:${failH}%"${failH > 0 ? ` data-tooltip="${d.failed} failed"` : ""}></div>
              <div class="bar success" style="height:${successH}%"${successH > 0 ? ` data-tooltip="${d.completed} completed"` : ""}></div>
            </div>
            <div class="bar-label">${escapeHtml(label)}</div>
          </div>`;
    })
    .join("\n");
})()}
        </div>
      </div>
${(() => {
  if (typeFilter) return "";
  const typeColors: Record<string, string> = { create: "var(--success)", review: "#5dade2" };
  const extraColors = ["#8B5CF6", "#e2b93d", "#e9607a", "#3dd8e2", "#a3e23d"];
  let colorIdx = 0;
  const chartTypes = [...new Set(dailyStats.flatMap(d => Object.keys(d.perType)))].sort();
  if (chartTypes.length < 2) return "";
  for (const t of chartTypes) {
    if (!typeColors[t]) { typeColors[t] = extraColors[colorIdx % extraColors.length]; colorIdx++; }
  }
  return `      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:0.75rem;color:var(--text-dim)">
${chartTypes.map(t => `        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${typeColors[t]};margin-right:4px;vertical-align:middle"></span>${escapeHtml(t)}</span>`).join("\n")}
      </div>`;
})()}
    </div>
    <div class="chart-card">
      <h3>Cost per Day (Last 14 Days)</h3>
      <div class="chart-with-axis">
        <div class="y-axis">
          <span class="y-label">${formatCostLabel(maxCostPerDay)}</span>
          <span class="y-label">${formatCostLabel(maxCostPerDay / 2)}</span>
          <span class="y-label">$0</span>
        </div>
        <div class="bar-chart">
${dailyStats
  .map((d, i) => {
    const h = Math.round((d.cost / maxCostPerDay) * 100);
    const shortDate = formatShortDate(d.date);
    const label = chartDateLabel(d.date, i > 0 ? dailyStats[i - 1].date : null);
    return `          <div class="bar-group" data-tooltip="${shortDate}: $${d.cost.toFixed(2)}">
            <div class="bar-stack">
              <div class="bar cost" style="height:${h}%"${h > 0 ? ` data-tooltip="$${d.cost.toFixed(2)}"` : ""}></div>
            </div>
            <div class="bar-label">${escapeHtml(label)}</div>
          </div>`;
  })
  .join("\n")}
        </div>
      </div>
    </div>
    <div class="chart-card">
      <h3>Avg Duration per Day (Last 14 Days)</h3>
      <div class="chart-with-axis">
        <div class="y-axis">
          <span class="y-label">${formatDurationMinutes(maxDurationPerDay)}</span>
          <span class="y-label">${formatDurationMinutes(maxDurationPerDay / 2)}</span>
          <span class="y-label">0m</span>
        </div>
        <div class="bar-chart">
${dailyStats
  .map((d, i) => {
    const h = maxDurationPerDay > 0 ? Math.round((d.avgDuration / maxDurationPerDay) * 100) : 0;
    const shortDate = formatShortDate(d.date);
    const label = chartDateLabel(d.date, i > 0 ? dailyStats[i - 1].date : null);
    return `          <div class="bar-group" data-tooltip="${shortDate}: ${fmtDuration(d.avgDuration)}">
            <div class="bar-stack">
              <div class="bar duration" style="height:${h}%"${h > 0 ? ` data-tooltip="${fmtDuration(d.avgDuration)}"` : ""}></div>
            </div>
            <div class="bar-label">${escapeHtml(label)}</div>
          </div>`;
  })
  .join("\n")}
        </div>
      </div>
    </div>
    <div class="chart-card">
      <h3>Success vs Failure</h3>
      <div class="donut-chart">
${totalTasks > 0 ? (() => {
  const successPct = Math.round((succeeded / totalTasks) * 100);
  const failPct = 100 - successPct;
  return `        <svg viewBox="0 0 36 36" class="donut-svg">
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--border)" stroke-width="2.5"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--success)" stroke-width="2.5"
            stroke-dasharray="${successPct}, 100" stroke-dashoffset="25" stroke-linecap="round"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--failure)" stroke-width="2.5"
            stroke-dasharray="${failPct}, 100" stroke-dashoffset="${25 - successPct}" stroke-linecap="round"/>
          <text x="18" y="18" class="donut-text">${successPct}%</text>
        </svg>
        <div class="donut-legend">${succeeded} passed &middot; ${failed} failed</div>`;
})() : `        <svg viewBox="0 0 36 36" class="donut-svg">
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--border)" stroke-width="2.5"/>
          <text x="18" y="18" class="donut-text">N/A</text>
        </svg>
        <div class="donut-legend">No data</div>`}
      </div>
    </div>
  </div>

  <div class="table-section">
    <h2>Recent Activity</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Type</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Cost</th>
            <th>PR</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
${recentActivity.length === 0 ? '          <tr><td colspan="7" class="empty-state"><span class="empty-state-icon">&#x1F4CB;</span>No activity yet</td></tr>' : recentActivity
  .map((m) => {
    const id = escapeHtml(m.identifier ?? m.issueId ?? "\u2014");
    const typeName = escapeHtml(m.critterType ?? (m.event.startsWith("review_") ? "review" : "create"));
    const isReview = m.event === "review_completed" || m.event === "review_failed";
    const isOk = m.event === "task_completed" || m.event === "review_completed";
    const badgeClass = isReview
      ? (isOk ? "badge badge-review" : "badge badge-failure")
      : (isOk ? "badge badge-success" : "badge badge-failure");
    const statusText = isReview
      ? (isOk ? "Review Completed" : "Review Failed")
      : (isOk ? "Completed" : "Failed");
    const dur = fmtDuration(m.duration);
    const cost = formatCost(m.costUsd);
    const pr = m.prUrl
      ? `<a href="${escapeHtml(m.prUrl)}" target="_blank" rel="noopener">PR</a>`
      : "\u2014";
    const when = formatDate(m.timestamp);
    return `          <tr>
            <td>${id}</td>
            <td>${typeName}</td>
            <td><span class="${badgeClass}">${statusText}</span></td>
            <td>${dur}</td>
            <td>${cost}</td>
            <td>${pr}</td>
            <td>${when}</td>
          </tr>`;
  })
  .join("\n")}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
