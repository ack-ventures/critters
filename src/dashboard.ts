import type { HealthStatus } from "./health.js";
import { extractPhaseResult, resolveAllPhases, resolveWorkDirForIdentifier } from "./log-resolver.js";
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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${MONTHS[monthIdx] ?? parts[1]} ${day}`;
}

function chartDateLabel(dateStr: string, prevDateStr: string | null): string {
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parts[1];
  const monthIdx = parseInt(month, 10) - 1;

  // Show month name + day when month changes (or for the first label)
  if (prevDateStr == null) {
    return `${MONTHS[monthIdx] ?? month} ${day}`;
  }

  const prevParts = prevDateStr.split("-");
  if (prevParts.length >= 2 && prevParts[1] !== month) {
    return `${MONTHS[monthIdx] ?? month} ${day}`;
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

export function renderDashboard(metricsPath: string, status: HealthStatus, uptime: number, typeFilter?: string, dashboardToken?: string): string {
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

  // Per-type stats breakdown
  const perTypeStats = new Map<string, {
    total: number;
    succeeded: number;
    failed: number;
    totalCost: number;
    durations: number[];
  }>();

  for (const m of taskMetrics) {
    const typeName = inferType(m);
    let entry = perTypeStats.get(typeName);
    if (!entry) {
      entry = { total: 0, succeeded: 0, failed: 0, totalCost: 0, durations: [] };
      perTypeStats.set(typeName, entry);
    }
    entry.total++;
    if (m.event === "task_completed" || m.event === "review_completed") {
      entry.succeeded++;
    } else {
      entry.failed++;
    }
    entry.totalCost += m.costUsd ?? 0;
    if (m.duration != null && !Number.isNaN(m.duration)) {
      entry.durations.push(m.duration);
    }
  }

  // Recent activity (last 50)
  const recentActivity = taskMetrics.slice(-50).reverse();

  const activityTypes = [...new Set(recentActivity.map(m => {
    return m.critterType ?? (m.event.startsWith("review_") ? "review" : "create");
  }))].sort();

  const activityStatuses = [...new Set(recentActivity.map(m => {
    const isRev = m.event === "review_completed" || m.event === "review_failed";
    const isOk = m.event === "task_completed" || m.event === "review_completed";
    return isRev ? (isOk ? "Review Completed" : "Review Failed") : (isOk ? "Completed" : "Failed");
  }))].sort();

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
  <noscript><meta http-equiv="refresh" content="30;url=${typeFilter ? `/dashboard?type=${encodeURIComponent(typeFilter)}` : `/dashboard`}"></noscript>
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
    .type-stats { margin-bottom: 24px; }
    .type-stats h3 {
      font-size: 0.85rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
    .type-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .type-stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
    }
    .type-stat-name {
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--text);
      text-transform: capitalize;
    }
    .type-stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      padding: 2px 0;
    }
    .type-stat-label { color: var(--text-dim); }
    .type-stat-value { color: var(--text); font-weight: 600; }
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
      cursor: pointer;
      background: none;
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
    td .badge { cursor: pointer; }
    td .badge:hover { filter: brightness(1.2); }
    .badge-type {
      background: rgba(93, 173, 226, 0.1);
      color: var(--text-dim);
    }
    .badge-type:hover {
      color: var(--text);
      background: rgba(93, 173, 226, 0.2);
    }
    th[data-sortable] { cursor: pointer; user-select: none; }
    th[data-sortable]:hover { color: var(--text); }
    .sort-arrow { font-size: 0.65rem; margin-left: 4px; }
    a { color: #5dade2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .log-preview-row td { background: #0d1117 !important; }
    .log-preview-content {
      background: #0d1117;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
      font-size: 0.75rem;
      padding: 12px;
      max-height: 300px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #c9d1d9;
      line-height: 1.5;
    }
    .log-preview-link { font-size: 0.8rem; }

    @media (max-width: 768px) {
      body { padding: 12px; }
      .summary { grid-template-columns: repeat(2, 1fr); gap: 10px; }
      .card .value { font-size: 1.4rem; }
      .charts { grid-template-columns: 1fr; }
      .bar-chart { gap: 2px; }
      .bar-group:nth-child(even) .bar-label { visibility: hidden; }
      .bar-label { transform: rotate(-45deg); transform-origin: top center; font-size: 0.55rem; }
      .y-axis { min-width: 35px; width: auto; }
      .type-stats-grid { grid-template-columns: repeat(2, 1fr); }
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
      <span class="meta-sep">|</span>
      <button id="poll-btn" style="background:var(--accent);border:1px solid var(--border);color:var(--text);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.85rem;">Poll Now</button>
      <span class="meta-sep">|</span>
      <button id="new-critter-btn" style="background:var(--accent);border:1px solid var(--border);color:var(--text);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.85rem;">+ New Critter</button>
      <span class="meta-sep">|</span>
      <button id="notif-btn" title="Enable browser notifications" style="background:var(--accent);border:1px solid var(--border);color:var(--text);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.85rem;position:relative;">🔔 <span id="notif-dot" style="display:none;position:absolute;top:2px;right:2px;width:6px;height:6px;background:var(--success);border-radius:50%;"></span></button>
      <span class="meta-sep">|</span>
      <span id="refresh-countdown" class="meta">Refreshing in 30s</span>
    </div>
  </div>

  <div id="auth-prompt" style="display:none;background:var(--card-bg);border:1px solid var(--border);border-radius:6px;padding:8px 16px;margin-bottom:12px;">
    <span style="color:var(--text-dim);margin-right:8px;">Dashboard token required:</span>
    <input type="password" id="auth-token-input" placeholder="Enter token" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:0.85rem;">
    <button id="auth-save-btn" style="background:var(--accent);border:1px solid var(--border);color:var(--text);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.85rem;margin-left:4px;">Save</button>
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

${perTypeStats.size >= 2 ? `  <div class="type-stats">
    <h3>Per-Type Breakdown</h3>
    <div class="type-stats-grid">
${[...perTypeStats.entries()]
  .sort((a, b) => b[1].total - a[1].total)
  .map(([typeName, stats]) => {
    const rate = stats.total > 0 ? Math.round((stats.succeeded / stats.total) * 100) : null;
    const avgCostVal = stats.total > 0 ? stats.totalCost / stats.total : null;
    const avgDur = stats.durations.length > 0
      ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
      : null;
    return `      <div class="type-stat-card">
        <div class="type-stat-name">${escapeHtml(typeName)}</div>
        <div class="type-stat-row">
          <span class="type-stat-label">Tasks</span>
          <span class="type-stat-value">${stats.succeeded}/${stats.total}</span>
        </div>
        <div class="type-stat-row">
          <span class="type-stat-label">Success</span>
          <span class="type-stat-value">${rate != null ? `${rate}%` : 'N/A'}</span>
        </div>
        <div class="type-stat-row">
          <span class="type-stat-label">Avg Cost</span>
          <span class="type-stat-value">${avgCostVal != null ? formatCost(avgCostVal) : 'N/A'}</span>
        </div>
        <div class="type-stat-row">
          <span class="type-stat-label">Avg Duration</span>
          <span class="type-stat-value">${avgDur != null ? fmtDuration(avgDur) : 'N/A'}</span>
        </div>
      </div>`;
  })
  .join("\n")}
    </div>
  </div>` : ''}

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
            <th>Cost</th>
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
  const costCell = (() => {
    if (d.costUsd == null || d.costUsd === 0) return '<span style="color:var(--text-muted)">&mdash;</span>';
    const costStr = `$${d.costUsd.toFixed(2)}`;
    if (d.costBudget != null && d.costBudget > 0) {
      const pct = d.costUsd / d.costBudget;
      const color = pct > 0.8 ? "var(--failure)" : pct > 0.5 ? "#e2b93d" : "var(--success)";
      return `<span style="color:${color}">${costStr} / $${d.costBudget.toFixed(2)}</span>`;
    }
    return costStr;
  })();
  return `          <tr onclick="toggleLogPreview('${escapeHtml(d.identifier)}', this)" style="cursor:pointer" title="Click to view logs">
            <td><a href="/dashboard/${encodeURIComponent(d.identifier)}">${escapeHtml(d.identifier)}</a></td>
            <td><span class="${phaseBadgeClass}">${phaseLabel}</span></td>
            <td>${escapeHtml(d.repo)}</td>
            <td><code>${escapeHtml(d.branch)}</code></td>
            <td>${prCell}</td>
            <td>${costCell}</td>
            <td class="${elapsedClass}">${elapsed}</td>
          </tr>
          <tr class="log-preview-row" id="log-preview-${escapeHtml(d.identifier)}" style="display:none">
            <td colspan="7" style="padding:0">
              <div class="log-preview-content" id="log-content-${escapeHtml(d.identifier)}"></div>
              <div style="padding:4px 12px 8px;text-align:right"><a href="/dashboard/${encodeURIComponent(d.identifier)}" class="log-preview-link">View details &rarr;</a></div>
            </td>
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
    <div id="activity-filters" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <span style="font-size:0.75rem;color:var(--text-dim);text-transform:uppercase;font-weight:600;">Type:</span>
      <button class="filter-btn active" data-filter-group="type" data-filter-value="">All</button>
${activityTypes.map(t => `      <button class="filter-btn" data-filter-group="type" data-filter-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("\n")}
      <span class="meta-sep">|</span>
      <span style="font-size:0.75rem;color:var(--text-dim);text-transform:uppercase;font-weight:600;">Status:</span>
      <button class="filter-btn active" data-filter-group="status" data-filter-value="">All</button>
${activityStatuses.map(s => `      <button class="filter-btn" data-filter-group="status" data-filter-value="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("\n")}
      <span class="meta-sep">|</span>
      <span id="row-counter" style="font-size:0.8rem;color:var(--text-dim);"></span>
      <button id="clear-filters-btn" class="filter-btn" style="display:none;background:var(--failure);border-color:var(--failure);color:#fff;">Clear filters</button>
    </div>
    <input type="text" id="activity-filter" placeholder="Filter by issue, type, or status..." style="background:var(--card-bg);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;width:100%;margin-bottom:12px;font-size:0.85rem;">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th data-sortable="string">Issue</th>
            <th data-sortable="string">Type</th>
            <th data-sortable="string">Status</th>
            <th data-sortable="duration">Duration</th>
            <th data-sortable="cost">Cost</th>
            <th>PR</th>
            <th>Logs</th>
            <th data-sortable="date">When</th>
          </tr>
        </thead>
        <tbody>
${recentActivity.length === 0 ? '          <tr><td colspan="8" class="empty-state"><span class="empty-state-icon">&#x1F4CB;</span>No activity yet</td></tr>' : recentActivity
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
    const rawId = m.identifier ?? m.issueId ?? "";
    const issueHref = m.issueUrl
      ? escapeHtml(m.issueUrl)
      : `/dashboard/${encodeURIComponent(rawId)}`;
    const issueTarget = m.issueUrl ? ' target="_blank" rel="noopener"' : '';
    const idLink = rawId ? `<a href="${issueHref}"${issueTarget}>${id}</a>` : id;
    const logsLink = rawId
      ? `<a href="/dashboard/${encodeURIComponent(rawId)}" title="View logs">logs</a>`
      : '\u2014';
    return `          <tr data-type="${typeName}" data-status="${statusText}">
            <td>${idLink}</td>
            <td><span class="badge badge-type">${typeName}</span></td>
            <td><span class="${badgeClass}">${statusText}</span></td>
            <td data-sort-value="${m.duration ?? -1}">${dur}</td>
            <td data-sort-value="${m.costUsd ?? -1}">${cost}</td>
            <td>${pr}</td>
            <td>${logsLink}</td>
            <td data-sort-value="${m.timestamp}">${when}</td>
          </tr>`;
  })
  .join("\n")}
        </tbody>
      </table>
    </div>
  </div>

<div id="create-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;">
  <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;max-width:500px;width:90%;padding:24px;">
    <h2 style="font-size:1.1rem;margin-bottom:16px;">Create Critter Ticket</h2>
    <div id="create-error" style="display:none;background:rgba(233,69,96,0.15);border:1px solid var(--failure);border-radius:4px;padding:8px;margin-bottom:12px;font-size:0.85rem;color:var(--failure);"></div>
    <div id="create-success" style="display:none;background:rgba(78,204,163,0.15);border:1px solid var(--success);border-radius:4px;padding:8px;margin-bottom:12px;font-size:0.85rem;color:var(--success);"></div>
    <form id="create-form">
      <div id="create-provider-wrap" style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Provider</label>
        <select id="create-provider" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;"></select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Team / Project</label>
        <select id="create-team" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;" required></select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Critter Type</label>
        <select id="create-type" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;"></select>
      </div>
      <div id="create-repo-wrap" style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Repository</label>
        <select id="create-repo" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;">
          <option value="">None (specify in description)</option>
        </select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Base Branch <span style="font-weight:normal;color:var(--text-dim);">(optional)</span></label>
        <input type="text" id="create-branch" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;" placeholder="e.g. dev, beta (defaults to repo default branch)">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Title</label>
        <input type="text" id="create-title" required style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;" placeholder="Issue title">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Description</label>
        <textarea id="create-description" rows="6" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;resize:vertical;font-family:inherit;" placeholder="Include repo: git@github.com:org/repo.git on its own line if no project mapping exists"></textarea>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="create-cancel" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85rem;">Cancel</button>
        <button type="submit" id="create-submit" style="background:var(--success);border:none;color:#1a1a2e;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85rem;font-weight:600;">Create</button>
      </div>
    </form>
  </div>
</div>

<script>
var __dashboardToken = ${dashboardToken ? JSON.stringify(dashboardToken) : "null"};
var paused = false;

function getAuthHeaders() {
  var token = __dashboardToken || localStorage.getItem('critters-token');
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function showAuthPrompt() {
  var prompt = document.getElementById('auth-prompt');
  if (prompt) prompt.style.display = 'block';
}

(function() {
  var saveBtn = document.getElementById('auth-save-btn');
  var tokenInput = document.getElementById('auth-token-input');
  if (!saveBtn || !tokenInput) return;

  saveBtn.addEventListener('click', function() {
    var val = tokenInput.value.trim();
    if (val) {
      localStorage.setItem('critters-token', val);
      document.getElementById('auth-prompt').style.display = 'none';
    }
  });

  fetch('/api/v1/auth-check').then(function(r) { return r.json(); }).then(function(data) {
    if (data.required && !__dashboardToken && !localStorage.getItem('critters-token')) {
      showAuthPrompt();
    }
  }).catch(function() {});
})();

(function() {
  var table = document.querySelector('.table-section table');
  if (!table) return;
  var thead = table.querySelector('thead');
  var tbody = table.querySelector('tbody');
  var headers = thead.querySelectorAll('th[data-sortable]');
  var currentSort = { col: -1, asc: true };

  headers.forEach(function(th) {
    var colIdx = Array.from(thead.querySelectorAll('th')).indexOf(th);
    th.addEventListener('click', function() {
      var asc = currentSort.col === colIdx ? !currentSort.asc : true;
      currentSort = { col: colIdx, asc: asc };

      headers.forEach(function(h) {
        var arrow = h.querySelector('.sort-arrow');
        if (arrow) arrow.remove();
      });

      var arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = asc ? '\\u25B2' : '\\u25BC';
      th.appendChild(arrow);

      var rows = Array.from(tbody.querySelectorAll('tr'));
      var sortType = th.getAttribute('data-sortable');

      rows.sort(function(a, b) {
        var cellA = a.cells[colIdx];
        var cellB = b.cells[colIdx];
        var valA, valB;

        if (sortType === 'duration' || sortType === 'cost' || sortType === 'date') {
          valA = cellA.getAttribute('data-sort-value') || '';
          valB = cellB.getAttribute('data-sort-value') || '';
          if (sortType === 'date') {
            valA = new Date(valA).getTime() || 0;
            valB = new Date(valB).getTime() || 0;
          } else {
            valA = parseFloat(valA) || -1;
            valB = parseFloat(valB) || -1;
          }
        } else {
          valA = (cellA.textContent || '').toLowerCase();
          valB = (cellB.textContent || '').toLowerCase();
        }

        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
      });

      rows.forEach(function(row) { tbody.appendChild(row); });
    });
  });
})();

(function() {
  var filterBar = document.getElementById('activity-filters');
  var table = document.querySelector('.table-section table');
  if (!filterBar || !table) return;
  var tbody = table.querySelector('tbody');
  var counterEl = document.getElementById('row-counter');
  var clearBtn = document.getElementById('clear-filters-btn');
  var textInput = document.getElementById('activity-filter');

  var activeFilters = { type: '', status: '' };

  // Read initial filter state from URL
  var params = new URLSearchParams(window.location.search);
  var initType = params.get('ftype') || '';
  var initStatus = params.get('fstatus') || '';
  activeFilters.type = initType;
  activeFilters.status = initStatus;

  // Highlight initial active buttons
  filterBar.querySelectorAll('[data-filter-group]').forEach(function(btn) {
    var group = btn.getAttribute('data-filter-group');
    var val = btn.getAttribute('data-filter-value');
    btn.classList.toggle('active', val === activeFilters[group]);
  });

  function updateURL() {
    var url = new URL(window.location);
    if (activeFilters.type) url.searchParams.set('ftype', activeFilters.type);
    else url.searchParams.delete('ftype');
    if (activeFilters.status) url.searchParams.set('fstatus', activeFilters.status);
    else url.searchParams.delete('fstatus');
    history.replaceState(null, '', url.toString());
  }

  function applyFilters() {
    var rows = tbody.querySelectorAll('tr');
    var total = rows.length;
    var visible = 0;
    var textQuery = textInput ? textInput.value.toLowerCase() : '';

    rows.forEach(function(row) {
      var matchType = !activeFilters.type || row.getAttribute('data-type') === activeFilters.type;
      var matchStatus = !activeFilters.status || row.getAttribute('data-status') === activeFilters.status;
      var matchText = !textQuery || row.textContent.toLowerCase().includes(textQuery);
      var show = matchType && matchStatus && matchText;
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    if (counterEl) {
      var hasFilter = activeFilters.type || activeFilters.status || textQuery;
      counterEl.textContent = hasFilter ? 'Showing ' + visible + ' of ' + total : total + ' entries';
    }

    if (clearBtn) {
      clearBtn.style.display = (activeFilters.type || activeFilters.status) ? '' : 'none';
    }

    updateURL();
  }

  // Filter button clicks
  filterBar.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-filter-group]');
    if (!btn) {
      if (e.target.id === 'clear-filters-btn' || e.target.closest('#clear-filters-btn')) {
        activeFilters.type = '';
        activeFilters.status = '';
        filterBar.querySelectorAll('[data-filter-group]').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-filter-value') === '');
        });
        applyFilters();
      }
      return;
    }

    var group = btn.getAttribute('data-filter-group');
    var val = btn.getAttribute('data-filter-value');
    activeFilters[group] = val;

    filterBar.querySelectorAll('[data-filter-group="' + group + '"]').forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-filter-value') === val);
    });

    applyFilters();
  });

  // Make table badges clickable (status badges and type badges)
  tbody.addEventListener('click', function(e) {
    var badge = e.target.closest('.badge');
    if (!badge) return;
    var row = badge.closest('tr');
    if (!row) return;
    if (e.target.tagName === 'A') return;

    var cell = badge.closest('td');
    var cellIdx = Array.from(row.cells).indexOf(cell);

    if (cellIdx === 1) {
      // Type column
      var typeVal = row.getAttribute('data-type');
      activeFilters.type = typeVal;
      filterBar.querySelectorAll('[data-filter-group="type"]').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-filter-value') === typeVal);
      });
      applyFilters();
    } else if (cellIdx === 2) {
      // Status column
      var statusVal = row.getAttribute('data-status');
      activeFilters.status = statusVal;
      filterBar.querySelectorAll('[data-filter-group="status"]').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-filter-value') === statusVal);
      });
      applyFilters();
    }
  });

  // Override the existing text filter to work with badge filters
  if (textInput) {
    var newInput = textInput.cloneNode(true);
    textInput.parentNode.replaceChild(newInput, textInput);
    newInput.addEventListener('input', function() { applyFilters(); });
    textInput = newInput;
  }

  // Apply initial filters
  applyFilters();
})();

(function() {
  var btn = document.getElementById('poll-btn');
  if (!btn) return;

  btn.addEventListener('click', function() {
    btn.disabled = true;
    btn.textContent = 'Polling...';
    var headers = getAuthHeaders();
    fetch('/poll', { method: 'POST', headers: headers })
      .then(function(res) { return res.json(); })
      .then(function() {
        btn.textContent = 'Triggered!';
        setTimeout(function() {
          btn.textContent = 'Poll Now';
          btn.disabled = false;
        }, 2000);
      })
      .catch(function() {
        btn.textContent = 'Failed';
        setTimeout(function() {
          btn.textContent = 'Poll Now';
          btn.disabled = false;
        }, 2000);
      });
  });
})();

(function() {
  if (window._refreshInterval) clearInterval(window._refreshInterval);
  var INTERVAL = 30;
  var remaining = INTERVAL;
  var countdownEl = document.getElementById('refresh-countdown');

  var filterInput = document.getElementById('activity-filter');
  if (filterInput) {
    filterInput.addEventListener('focus', function() { paused = true; });
    filterInput.addEventListener('blur', function() { paused = false; });
  }

  function updateCountdown() {
    if (countdownEl) {
      countdownEl.textContent = 'Refreshing in ' + remaining + 's';
    }
  }

  function doRefresh() {
    var url = '/dashboard' + window.location.search;
    fetch(url)
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var newBody = doc.querySelector('body');
        if (newBody) {
          document.body.innerHTML = newBody.innerHTML;
          var scripts = document.body.querySelectorAll('script');
          scripts.forEach(function(s) {
            var ns = document.createElement('script');
            ns.textContent = s.textContent;
            s.parentNode.replaceChild(ns, s);
          });
        }
      })
      .catch(function() {
        window.location.reload();
      });
  }

  window._refreshInterval = setInterval(function() {
    if (paused) return;
    remaining--;
    if (remaining <= 0) {
      remaining = INTERVAL;
      doRefresh();
    }
    updateCountdown();
  }, 1000);

  updateCountdown();
})();

// Log preview toggle for active critters
var _logPollers = {};
function toggleLogPreview(identifier, row) {
  // Don't toggle if clicking a link
  if (event && event.target && event.target.tagName === 'A') return;
  var previewRow = document.getElementById('log-preview-' + identifier);
  if (!previewRow) return;

  if (previewRow.style.display === 'none') {
    previewRow.style.display = '';
    fetchLogPreview(identifier);
    _logPollers[identifier] = setInterval(function() {
      fetchLogPreview(identifier);
    }, 3000);
  } else {
    previewRow.style.display = 'none';
    if (_logPollers[identifier]) {
      clearInterval(_logPollers[identifier]);
      delete _logPollers[identifier];
    }
  }
}

function fetchLogPreview(identifier) {
  var contentEl = document.getElementById('log-content-' + identifier);
  if (!contentEl) return;
  fetch('/api/logs/' + encodeURIComponent(identifier) + '?tail=50')
    .then(function(res) {
      if (!res.ok) throw new Error('Not found');
      return res.text();
    })
    .then(function(text) {
      contentEl.textContent = text || 'Waiting for logs...';
      contentEl.scrollTop = contentEl.scrollHeight;
    })
    .catch(function() {
      contentEl.textContent = 'Waiting for logs...';
    });
}

(function() {
  var modal = document.getElementById('create-modal');
  var openBtn = document.getElementById('new-critter-btn');
  var cancelBtn = document.getElementById('create-cancel');
  var form = document.getElementById('create-form');
  var providerWrap = document.getElementById('create-provider-wrap');
  var providerSelect = document.getElementById('create-provider');
  var teamSelect = document.getElementById('create-team');
  var typeSelect = document.getElementById('create-type');
  var errorEl = document.getElementById('create-error');
  var successEl = document.getElementById('create-success');
  var submitBtn = document.getElementById('create-submit');
  var metadataCache = null;

  function hideModal() {
    modal.style.display = 'none';
    paused = false;
  }

  function showModal() {
    modal.style.display = 'flex';
    paused = true;
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    form.reset();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create';
    loadMetadata();
  }

  openBtn.addEventListener('click', showModal);
  cancelBtn.addEventListener('click', hideModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) hideModal(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.style.display !== 'none') hideModal(); });

  function loadMetadata() {
    if (metadataCache) { populateDropdowns(metadataCache); return; }
    fetch('/api/v1/metadata').then(function(r) { return r.json(); }).then(function(data) {
      metadataCache = data;
      populateDropdowns(data);
    }).catch(function() {
      errorEl.textContent = 'Failed to load metadata';
      errorEl.style.display = 'block';
    });
  }

  function populateDropdowns(data) {
    var providers = Object.keys(data.providers || {});
    providerSelect.innerHTML = '';
    providers.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      providerSelect.appendChild(opt);
    });
    providerWrap.style.display = providers.length > 1 ? '' : 'none';

    typeSelect.innerHTML = '';
    var types = data.critterTypes || [];
    types.forEach(function(ct) {
      var opt = document.createElement('option');
      opt.value = ct.name; opt.textContent = ct.name + ' (' + ct.triggerLabel + ')';
      typeSelect.appendChild(opt);
    });

    var repoSelect = document.getElementById('create-repo');
    var repoWrap = document.getElementById('create-repo-wrap');
    var repos = data.repos || [];
    repoSelect.innerHTML = '<option value="">None (specify in description)</option>';
    repos.forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r.url;
      opt.textContent = r.label;
      repoSelect.appendChild(opt);
    });
    repoWrap.style.display = repos.length > 0 ? '' : 'none';

    updateTeams(data);
  }

  providerSelect.addEventListener('change', function() {
    if (metadataCache) updateTeams(metadataCache);
  });

  function updateTeams(data) {
    var provider = providerSelect.value;
    var teams = (data.providers[provider] || {}).teams || [];
    teamSelect.innerHTML = '';
    teams.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name + ' (' + t.key + ')';
      teamSelect.appendChild(opt);
    });
  }

  function escapeText(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    var selectedRepo = document.getElementById('create-repo').value;
    var selectedBranch = document.getElementById('create-branch').value.trim();
    var description = document.getElementById('create-description').value;
    var prefix = '';
    if (selectedRepo && !/^repo:\\s/m.test(description)) {
      prefix += 'repo: ' + selectedRepo + '\\n';
    }
    if (selectedBranch && !/^branch:\\s/m.test(description)) {
      prefix += 'branch: ' + selectedBranch + '\\n';
    }
    if (prefix) {
      description = prefix + '\\n' + description;
    }

    var body = {
      provider: providerSelect.value,
      teamId: teamSelect.value,
      title: document.getElementById('create-title').value,
      description: description,
      critterType: typeSelect.value
    };

    fetch('/api/v1/issues', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify(body)
    })
    .then(function(res) {
      if (res.status === 401) {
        localStorage.removeItem('critters-token');
        showAuthPrompt();
        throw new Error('Unauthorized - please set your token');
      }
      return res.json();
    })
    .then(function(data) {
      if (data.success) {
        var msg = 'Created ' + escapeText(data.identifier);
        if (data.url) {
          var a = document.createElement('a');
          a.href = data.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = 'View';
          msg += ' \\u2014 ';
          successEl.innerHTML = msg;
          successEl.appendChild(a);
        } else {
          successEl.textContent = msg;
        }
        successEl.style.display = 'block';
        fetch('/poll', { method: 'POST', headers: getAuthHeaders() }).catch(function() {});
        setTimeout(hideModal, 5000);
      } else {
        errorEl.textContent = data.error || 'Unknown error';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
      }
    })
    .catch(function(err) {
      errorEl.textContent = err.message || 'Request failed';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create';
    });
  });
})();
</script>
<script>
(function() {
  if (!window._notifState) {
    window._notifState = {
      enabled: localStorage.getItem('critters-notif') === 'on',
      lastSeenTimestamp: localStorage.getItem('critters-notif-last-seen') || new Date().toISOString()
    };
  }

  var state = window._notifState;
  var btn = document.getElementById('notif-btn');
  var dot = document.getElementById('notif-dot');

  function updateUI() {
    if (dot) dot.style.display = state.enabled ? 'inline-block' : 'none';
    if (btn) btn.title = state.enabled ? 'Notifications enabled (click to disable)' : 'Enable browser notifications';
  }
  updateUI();

  if (btn) {
    btn.addEventListener('click', function() {
      if (!('Notification' in window)) return;

      if (Notification.permission === 'default') {
        Notification.requestPermission().then(function(perm) {
          if (perm === 'granted') {
            state.enabled = true;
            state.lastSeenTimestamp = new Date().toISOString();
            localStorage.setItem('critters-notif', 'on');
            localStorage.setItem('critters-notif-last-seen', state.lastSeenTimestamp);
            updateUI();
          }
        });
      } else if (Notification.permission === 'granted') {
        state.enabled = !state.enabled;
        localStorage.setItem('critters-notif', state.enabled ? 'on' : 'off');
        if (state.enabled) {
          state.lastSeenTimestamp = new Date().toISOString();
          localStorage.setItem('critters-notif-last-seen', state.lastSeenTimestamp);
        }
        updateUI();
      }
    });
  }

  if (state.enabled && 'Notification' in window && Notification.permission === 'granted') {
    fetch('/metrics')
      .then(function(res) { return res.json(); })
      .then(function(events) {
        var newEvents = events.filter(function(e) {
          return e.timestamp > state.lastSeenTimestamp;
        });

        newEvents.forEach(function(e) {
          var title = '';
          var id = e.identifier || e.issueId || 'Unknown';
          var tag = 'critters-' + id + '-' + e.event;

          if (e.event === 'task_completed') {
            title = '\\u2705 ' + id + (e.prUrl ? ' completed \\u2014 PR created' : ' completed');
          } else if (e.event === 'task_failed') {
            title = '\\u274c ' + id + ' failed';
          } else if (e.event === 'review_completed' && e.outcome === 'needs_changes') {
            title = '\\ud83d\\udc40 ' + id + ' needs human review';
          } else {
            return;
          }

          var notif = new Notification(title, {
            body: e.critterType ? 'Type: ' + e.critterType : '',
            tag: tag
          });
          notif.onclick = function() {
            window.focus();
            window.location.href = '/dashboard/' + id;
            notif.close();
          };
        });

        if (events.length > 0) {
          var latest = events.reduce(function(max, e) {
            return e.timestamp > max ? e.timestamp : max;
          }, state.lastSeenTimestamp);
          state.lastSeenTimestamp = latest;
          localStorage.setItem('critters-notif-last-seen', latest);
        }
      })
      .catch(function() {});
  }
})();
</script>
</body>
</html>`;
}

export function renderLogPage(identifier: string, status: HealthStatus, workDir: string): string {
  const safeId = escapeHtml(identifier);
  // Check if critter is currently active
  const activeDetail = status.activeCritterDetails.find((d) => d.identifier === identifier);
  const isActive = !!activeDetail;

  // Find work directory
  let targetDir: string | null = null;
  if (activeDetail?.workDir) {
    targetDir = activeDetail.workDir;
  } else {
    targetDir = resolveWorkDirForIdentifier(workDir, identifier);
  }

  // Get available phases
  const phases = targetDir ? resolveAllPhases(targetDir) : [];
  // Phase display info
  const phaseLabel = activeDetail?.phase === "plan" || activeDetail?.phase === "planning" ? "Planning"
    : activeDetail?.phase === "exec" || activeDetail?.phase === "execution" ? "Execution"
    : activeDetail?.phase === "review" ? "Review"
    : activeDetail?.phase ?? "";

  const elapsedStr = activeDetail ? fmtDuration(Date.now() - activeDetail.startedAt) : "";

  const noLogs = !targetDir || phases.length === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logs: ${safeId} - Critters</title>
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
    a { color: #5dade2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .header { margin-bottom: 20px; }
    .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .header-top h1 { font-size: 1.3rem; }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-live {
      background: rgba(78, 204, 163, 0.2);
      color: var(--success);
      animation: pulse 2s ease-in-out infinite;
    }
    .badge-done {
      background: rgba(136, 146, 164, 0.2);
      color: var(--text-dim);
    }
    .badge-phase {
      background: rgba(93, 173, 226, 0.15);
      color: #5dade2;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .meta { color: var(--text-dim); font-size: 0.85rem; }
    .phase-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .phase-tab {
      padding: 6px 16px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text-dim);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition: all 0.15s;
    }
    .phase-tab:hover { border-color: var(--text-dim); color: var(--text); }
    .phase-tab.active { background: #5dade2; border-color: #5dade2; color: #fff; }
    #log-content {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
      font-size: 0.8rem;
      padding: 16px;
      min-height: 400px;
      max-height: calc(100vh - 220px);
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #c9d1d9;
      line-height: 1.6;
    }
    .empty-msg {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-dim);
    }
    .new-logs-indicator {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #5dade2;
      color: #fff;
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      display: none;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .new-logs-indicator:hover {
      background: #3498db;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <a href="/dashboard">&larr; Dashboard</a>
      <h1>${safeId}</h1>
      ${isActive ? `<span class="badge badge-live">Live</span>` : `<span class="badge badge-done">Completed</span>`}
      ${isActive && phaseLabel ? `<span class="badge badge-phase">${escapeHtml(phaseLabel)}</span>` : ""}
    </div>
    <div class="meta">
      ${isActive && activeDetail ? `${escapeHtml(activeDetail.repo)} &middot; <code>${escapeHtml(activeDetail.branch)}</code> &middot; ${elapsedStr}` : ""}
      ${activeDetail?.prUrl ? ` &middot; <a href="${escapeHtml(activeDetail.prUrl)}" target="_blank">PR</a>` : ""}
    </div>
  </div>

${noLogs && !isActive ? `  <div class="empty-msg">Logs are no longer available for this critter.<br>The work directory may have been cleaned up.</div>` : `
  ${phases.length > 1 ? `<div class="phase-tabs">
${phases.map((p) => `    <button class="phase-tab${p.phase === (phases[phases.length - 1]?.phase) ? " active" : ""}" data-phase="${escapeHtml(p.phase)}">${escapeHtml(p.phase.charAt(0).toUpperCase() + p.phase.slice(1))}</button>`).join("\n")}
  </div>` : ""}

  <pre id="log-content">Loading...</pre>
  <div id="new-logs-indicator" class="new-logs-indicator">↓ New logs</div>
`}

<script>
(function() {
  var identifier = ${JSON.stringify(identifier)};
  var isActive = ${isActive};
  var phases = ${JSON.stringify(phases.map((p) => p.phase))};
  var currentPhase = phases.length > 0 ? phases[phases.length - 1] : null;
  var logEl = document.getElementById('log-content');
  if (!logEl) return;

  var eventSource = null;
  var userScrolledUp = false;
  var firstMessage = true;
  var indicator = document.getElementById('new-logs-indicator');

  logEl.addEventListener('scroll', function() {
    var atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 50;
    userScrolledUp = !atBottom;
    if (atBottom && indicator) {
      indicator.style.display = 'none';
    }
  });

  if (indicator) {
    indicator.addEventListener('click', function() {
      logEl.scrollTop = logEl.scrollHeight;
      indicator.style.display = 'none';
      userScrolledUp = false;
    });
  }

  function loadPhase(phase) {
    currentPhase = phase;
    logEl.textContent = 'Loading...';
    userScrolledUp = false;
    firstMessage = true;
    if (indicator) indicator.style.display = 'none';

    // Update tab active state
    var tabs = document.querySelectorAll('.phase-tab');
    tabs.forEach(function(tab) {
      tab.classList.toggle('active', tab.getAttribute('data-phase') === phase);
    });

    // Close existing SSE
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (isActive) {
      // Use SSE as sole data source for active critters
      startSSE(phase);
    } else {
      // Fetch static content for completed critters
      var url = '/api/logs/' + encodeURIComponent(identifier) + '?tail=500';
      if (phase) url += '&phase=' + encodeURIComponent(phase);

      fetch(url)
        .then(function(res) {
          if (!res.ok) throw new Error('No logs');
          return res.text();
        })
        .then(function(text) {
          logEl.textContent = text || 'No logs available for this phase.';
          logEl.scrollTop = logEl.scrollHeight;
        })
        .catch(function() {
          logEl.textContent = 'No logs available for this phase.';
        });
    }
  }

  function startSSE(phase) {
    var sseUrl = '/api/logs/' + encodeURIComponent(identifier) + '/stream?tail=500';
    if (phase) sseUrl += '&phase=' + encodeURIComponent(phase);

    var retryCount = 0;
    var maxRetries = 5;

    eventSource = new EventSource(sseUrl);
    eventSource.onmessage = function(e) {
      var data = e.data;
      retryCount = 0;

      // Check for control events
      try {
        var obj = JSON.parse(data);
        if (obj.event === 'done') {
          eventSource.close();
          eventSource = null;
          isActive = false;
          // Update badge
          var badge = document.querySelector('.badge-live');
          if (badge) {
            badge.className = 'badge badge-done';
            badge.textContent = 'Completed';
          }
          return;
        }
        if (obj.event === 'heartbeat') return;
      } catch(ex) {}

      if (firstMessage) {
        logEl.textContent = '';
        firstMessage = false;
      }

      logEl.textContent += data + '\\n';

      if (!userScrolledUp) {
        logEl.scrollTop = logEl.scrollHeight;
      } else if (indicator) {
        indicator.style.display = 'block';
      }
    };
    eventSource.onerror = function() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (retryCount < maxRetries && isActive) {
        retryCount++;
        var delay = Math.min(2000 * Math.pow(2, retryCount - 1), 30000);
        setTimeout(function() {
          startSSE(phase);
        }, delay);
      }
    };
  }

  // Tab click handlers
  var tabs = document.querySelectorAll('.phase-tab');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      loadPhase(tab.getAttribute('data-phase'));
    });
  });

  // Initial load
  if (currentPhase) {
    loadPhase(currentPhase);
  }
})();
</script>
</body>
</html>`;
}

function formatTokenCount(n: number | undefined): string {
  if (n == null) return "\u2014";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function renderIssuePage(identifier: string, status: HealthStatus, workDir: string): string {
  const safeId = escapeHtml(identifier);
  const activeDetail = status.activeCritterDetails.find((d) => d.identifier === identifier);
  const isActive = !!activeDetail;

  // Find work directory
  let targetDir: string | null = null;
  if (activeDetail?.workDir) {
    targetDir = activeDetail.workDir;
  } else {
    targetDir = resolveWorkDirForIdentifier(workDir, identifier);
  }

  // Get available phases and their results
  const phases = targetDir ? resolveAllPhases(targetDir) : [];
  const phaseResults = phases.map((p) => ({
    phase: p.phase,
    logFile: p.logFile,
    result: extractPhaseResult(p.logFile),
  }));

  // Get metrics data for this identifier (fallback for cleaned-up work dirs)
  const allMetrics = getRecentMetrics(10000);
  const issueMetrics = allMetrics.filter((m) => m.identifier === identifier);
  // Find most recent task_started to scope to latest run
  const taskStarted = issueMetrics.filter((m) => m.event === "task_started").pop();
  const taskEnded = issueMetrics.filter((m) =>
    m.event === "task_completed" || m.event === "task_failed" ||
    m.event === "review_completed" || m.event === "review_failed",
  ).pop();
  const multipleRuns = issueMetrics.filter((m) => m.event === "task_started").length > 1;

  // Determine status
  const isCompleted = !!taskEnded && !isActive;
  const isFailed = taskEnded?.event === "task_failed" || taskEnded?.event === "review_failed";

  // Resolve metadata from active detail or metrics
  const title = activeDetail?.title ?? taskStarted?.identifier ?? "N/A";
  const critterType = activeDetail?.critterType ?? taskEnded?.critterType ?? taskStarted?.critterType ?? "\u2014";
  const repo = activeDetail?.repo ?? (() => {
    const url = taskStarted?.repoUrl ?? "";
    const match = url.match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    return match ? match[1] : url || "\u2014";
  })();
  const branch = activeDetail?.branch ?? "\u2014";
  const prUrl = activeDetail?.prUrl ?? taskEnded?.prUrl;
  const issueUrl = activeDetail?.issueUrl ?? taskStarted?.issueUrl ?? taskEnded?.issueUrl;

  // Cost/token aggregation from phase results (preferred) or metrics (fallback)
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let hasPhaseData = false;

  for (const pr of phaseResults) {
    if (pr.result) {
      hasPhaseData = true;
      totalCost += pr.result.costUsd ?? 0;
      totalInputTokens += pr.result.inputTokens ?? 0;
      totalOutputTokens += pr.result.outputTokens ?? 0;
      totalCacheReadTokens += pr.result.cacheReadTokens ?? 0;
    }
  }

  if (!hasPhaseData && taskEnded) {
    totalCost = taskEnded.costUsd ?? 0;
    totalInputTokens = taskEnded.inputTokens ?? 0;
    totalOutputTokens = taskEnded.outputTokens ?? 0;
    totalCacheReadTokens = taskEnded.cacheReadTokens ?? 0;
  }

  // Duration
  let durationStr = "\u2014";
  if (isActive && activeDetail) {
    durationStr = fmtDuration(Date.now() - activeDetail.startedAt);
  } else if (taskEnded?.duration != null) {
    durationStr = fmtDuration(taskEnded.duration);
  }

  // Started at
  let startedStr = "\u2014";
  if (isActive && activeDetail) {
    startedStr = formatDate(new Date(activeDetail.startedAt).toISOString());
  } else if (taskStarted) {
    startedStr = formatDate(taskStarted.timestamp);
  }

  // Current phase for active critter
  const currentPhaseLabel = activeDetail?.phase === "plan" || activeDetail?.phase === "planning" ? "Planning"
    : activeDetail?.phase === "exec" || activeDetail?.phase === "execution" ? "Execution"
    : activeDetail?.phase === "review" ? "Review"
    : activeDetail?.phase ?? "";

  // Status badge
  const statusBadge = isActive
    ? '<span class="badge badge-live">Live</span>'
    : isFailed
      ? '<span class="badge badge-failure">Failed</span>'
      : isCompleted
        ? '<span class="badge badge-success">Completed</span>'
        : '<span class="badge badge-done">Unknown</span>';

  const typeBadge = critterType !== "\u2014" ? `<span class="badge badge-phase">${escapeHtml(critterType)}</span>` : "";

  const noData = phases.length === 0 && !taskEnded && !isActive;
  const logsUnavailable = !targetDir || phases.length === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${isActive ? '<meta http-equiv="refresh" content="10">' : ""}
  <title>${safeId} - Critters</title>
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
    a { color: #5dade2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .header { margin-bottom: 20px; }
    .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .header-top h1 { font-size: 1.3rem; }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-live {
      background: rgba(78, 204, 163, 0.2);
      color: var(--success);
      animation: pulse 2s ease-in-out infinite;
    }
    .badge-done {
      background: rgba(136, 146, 164, 0.2);
      color: var(--text-dim);
    }
    .badge-success {
      background: rgba(78, 204, 163, 0.15);
      color: var(--success);
    }
    .badge-failure {
      background: rgba(233, 69, 96, 0.15);
      color: var(--failure);
    }
    .badge-phase {
      background: rgba(93, 173, 226, 0.15);
      color: #5dade2;
    }
    .badge-running {
      background: rgba(226, 185, 61, 0.15);
      color: #e2b93d;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .meta { color: var(--text-dim); font-size: 0.85rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card h3 { font-size: 0.9rem; color: var(--text-dim); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 16px;
      font-size: 0.85rem;
    }
    .info-label { color: var(--text-dim); }
    .cost-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
    }
    .cost-item { text-align: center; }
    .cost-item .value { font-size: 1.4rem; font-weight: 700; }
    .cost-item .label { font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
    .phase-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .phase-tab {
      padding: 6px 16px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text-dim);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition: all 0.15s;
    }
    .phase-tab:hover { border-color: var(--text-dim); color: var(--text); }
    .phase-tab.active { background: #5dade2; border-color: #5dade2; color: #fff; }
    #log-content {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
      font-size: 0.8rem;
      padding: 16px;
      min-height: 300px;
      max-height: calc(100vh - 220px);
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #c9d1d9;
      line-height: 1.6;
    }
    .empty-msg {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-dim);
    }
    .new-logs-indicator {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #5dade2;
      color: #fff;
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      display: none;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .new-logs-indicator:hover { background: #3498db; }
    .note { font-size: 0.8rem; color: var(--text-dim); font-style: italic; margin-top: 8px; }
    @media (max-width: 768px) {
      body { padding: 12px; }
      .cost-grid { grid-template-columns: repeat(2, 1fr); }
      .info-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
${noData ? `
  <div class="header">
    <div class="header-top">
      <a href="/dashboard">&larr; Dashboard</a>
      <h1>${safeId}</h1>
    </div>
  </div>
  <div class="empty-msg">No data found for this identifier.<br><a href="/dashboard">Back to dashboard</a></div>
` : `
  <div class="header">
    <div class="header-top">
      <a href="/dashboard">&larr; Dashboard</a>
      <h1>${issueUrl ? `<a href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener" style="color: inherit; text-decoration: none;">${safeId} <span style="font-size: 0.6em; opacity: 0.6;">&#x2197;</span></a>` : safeId}</h1>
      ${statusBadge}
      ${typeBadge}
    </div>
  </div>

  <div class="card">
    <h3>Issue Info</h3>
    <div class="info-grid">
      <span class="info-label">Title</span>
      <span>${escapeHtml(title)}</span>
      <span class="info-label">Identifier</span>
      <span>${issueUrl ? `<a href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener">${safeId} &#x2197;</a>` : safeId}</span>
      <span class="info-label">Type</span>
      <span>${escapeHtml(critterType)}</span>
      <span class="info-label">Repo</span>
      <span>${escapeHtml(repo)}</span>
      <span class="info-label">Branch</span>
      <span><code>${escapeHtml(branch)}</code></span>
      ${prUrl ? `<span class="info-label">PR</span>
      <span><a href="${escapeHtml(prUrl)}" target="_blank" rel="noopener">${escapeHtml(prUrl)}</a></span>` : ""}
      <span class="info-label">Started</span>
      <span>${startedStr}</span>
      <span class="info-label">Duration</span>
      <span>${durationStr}</span>
    </div>
    ${multipleRuns ? '<div class="note">Multiple runs detected for this identifier. Showing latest run.</div>' : ""}
  </div>

  <div class="card">
    <h3>Cost Summary</h3>
    <div class="cost-grid">
      <div class="cost-item">
        <div class="value">${formatCost(totalCost)}</div>
        <div class="label">Total Cost</div>
      </div>
      <div class="cost-item">
        <div class="value">${formatTokenCount(totalInputTokens || undefined)}</div>
        <div class="label">Input Tokens</div>
      </div>
      <div class="cost-item">
        <div class="value">${formatTokenCount(totalOutputTokens || undefined)}</div>
        <div class="label">Output Tokens</div>
      </div>
      <div class="cost-item">
        <div class="value">${formatTokenCount(totalCacheReadTokens || undefined)}</div>
        <div class="label">Cache Read</div>
      </div>
    </div>
  </div>

  ${phaseResults.length > 0 ? `<div class="card">
    <h3>Phase Timeline</h3>
    <table>
      <thead>
        <tr>
          <th>Phase</th>
          <th>Status</th>
          <th>Cost</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache</th>
          <th>Turns</th>
        </tr>
      </thead>
      <tbody>
${phaseResults.map((pr) => {
  const phaseName = pr.phase.charAt(0).toUpperCase() + pr.phase.slice(1);
  const isCurrentPhase = isActive && activeDetail &&
    (activeDetail.phase === pr.phase ||
     (activeDetail.phase === "plan" && pr.phase === "planning") ||
     (activeDetail.phase === "exec" && pr.phase === "execution"));
  const phaseStatus = isCurrentPhase && !pr.result
    ? '<span class="badge badge-running">Running</span>'
    : pr.result
      ? '<span class="badge badge-success">Done</span>'
      : '<span class="badge badge-done">\u2014</span>';
  return `        <tr>
          <td>${escapeHtml(phaseName)}</td>
          <td>${phaseStatus}</td>
          <td>${formatCost(pr.result?.costUsd)}</td>
          <td>${formatTokenCount(pr.result?.inputTokens)}</td>
          <td>${formatTokenCount(pr.result?.outputTokens)}</td>
          <td>${formatTokenCount(pr.result?.cacheReadTokens)}</td>
          <td>${pr.result?.numTurns ?? "\u2014"}</td>
        </tr>`;
}).join("\n")}
      </tbody>
    </table>
  </div>` : ""}

  ${logsUnavailable && !isActive ? `<div class="card">
    <h3>Logs</h3>
    <div class="empty-msg">Logs are no longer available. The work directory may have been cleaned up.</div>
  </div>` : `<div class="card">
    <h3>Logs</h3>
    ${phases.length > 1 ? `<div class="phase-tabs">
${phases.map((p) => `      <button class="phase-tab${p.phase === (phases[phases.length - 1]?.phase) ? " active" : ""}" data-phase="${escapeHtml(p.phase)}">${escapeHtml(p.phase.charAt(0).toUpperCase() + p.phase.slice(1))}</button>`).join("\n")}
    </div>` : ""}
    <pre id="log-content">Loading...</pre>
    <div id="new-logs-indicator" class="new-logs-indicator">&darr; New logs</div>
  </div>`}
`}

<script>
(function() {
  var identifier = ${JSON.stringify(identifier)};
  var isActive = ${isActive};
  var phases = ${JSON.stringify(phases.map((p) => p.phase))};
  var currentPhase = phases.length > 0 ? phases[phases.length - 1] : null;
  var logEl = document.getElementById('log-content');
  if (!logEl) return;

  var eventSource = null;
  var userScrolledUp = false;
  var firstMessage = true;
  var indicator = document.getElementById('new-logs-indicator');

  logEl.addEventListener('scroll', function() {
    var atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 50;
    userScrolledUp = !atBottom;
    if (atBottom && indicator) {
      indicator.style.display = 'none';
    }
  });

  if (indicator) {
    indicator.addEventListener('click', function() {
      logEl.scrollTop = logEl.scrollHeight;
      indicator.style.display = 'none';
      userScrolledUp = false;
    });
  }

  function loadPhase(phase) {
    currentPhase = phase;
    logEl.textContent = 'Loading...';
    userScrolledUp = false;
    firstMessage = true;
    if (indicator) indicator.style.display = 'none';

    var tabs = document.querySelectorAll('.phase-tab');
    tabs.forEach(function(tab) {
      tab.classList.toggle('active', tab.getAttribute('data-phase') === phase);
    });

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (isActive) {
      startSSE(phase);
    } else {
      var url = '/api/logs/' + encodeURIComponent(identifier) + '?tail=500';
      if (phase) url += '&phase=' + encodeURIComponent(phase);

      fetch(url)
        .then(function(res) {
          if (!res.ok) throw new Error('No logs');
          return res.text();
        })
        .then(function(text) {
          logEl.textContent = text || 'No logs available for this phase.';
          logEl.scrollTop = logEl.scrollHeight;
        })
        .catch(function() {
          logEl.textContent = 'No logs available for this phase.';
        });
    }
  }

  function startSSE(phase) {
    var sseUrl = '/api/logs/' + encodeURIComponent(identifier) + '/stream?tail=500';
    if (phase) sseUrl += '&phase=' + encodeURIComponent(phase);

    var retryCount = 0;
    var maxRetries = 5;

    eventSource = new EventSource(sseUrl);
    eventSource.onmessage = function(e) {
      var data = e.data;
      retryCount = 0;

      try {
        var obj = JSON.parse(data);
        if (obj.event === 'done') {
          eventSource.close();
          eventSource = null;
          isActive = false;
          var badge = document.querySelector('.badge-live');
          if (badge) {
            badge.className = 'badge badge-success';
            badge.textContent = 'Completed';
          }
          return;
        }
        if (obj.event === 'heartbeat') return;
      } catch(ex) {}

      if (firstMessage) {
        logEl.textContent = '';
        firstMessage = false;
      }

      logEl.textContent += data + '\\n';

      if (!userScrolledUp) {
        logEl.scrollTop = logEl.scrollHeight;
      } else if (indicator) {
        indicator.style.display = 'block';
      }
    };
    eventSource.onerror = function() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (retryCount < maxRetries && isActive) {
        retryCount++;
        var delay = Math.min(2000 * Math.pow(2, retryCount - 1), 30000);
        setTimeout(function() {
          startSSE(phase);
        }, delay);
      }
    };
  }

  var tabs = document.querySelectorAll('.phase-tab');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      loadPhase(tab.getAttribute('data-phase'));
    });
  });

  if (currentPhase) {
    loadPhase(currentPhase);
  }
})();
</script>
</body>
</html>`;
}
