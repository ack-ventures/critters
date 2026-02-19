import { type HealthStatus } from "./health.js";
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

type DayStat = { date: string; completed: number; failed: number; cost: number };

function computeDailyStats(metrics: MetricEvent[], days: number): DayStat[] {
  const now = new Date();
  const dateMap = new Map<string, DayStat>();

  // Pre-fill last N days
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateMap.set(key, { date: key, completed: 0, failed: 0, cost: 0 });
  }

  for (const m of metrics) {
    if (m.event !== "task_completed" && m.event !== "task_failed" &&
        m.event !== "review_completed" && m.event !== "review_failed") continue;
    const key = getDateKey(m.timestamp);
    const stat = dateMap.get(key);
    if (!stat) continue;
    if (m.event === "task_completed" || m.event === "review_completed") stat.completed++;
    else stat.failed++;
    stat.cost += m.costUsd ?? 0;
  }

  return Array.from(dateMap.values());
}

function niceMax(value: number, isCost: boolean): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
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

export function renderDashboard(metricsPath: string, status: HealthStatus): string {
  const allMetrics = getRecentMetrics(10000);
  const taskMetrics = allMetrics.filter(
    (m) => m.event === "task_completed" || m.event === "task_failed" ||
           m.event === "review_completed" || m.event === "review_failed",
  );

  // Summary stats
  const totalTasks = taskMetrics.length;
  const succeeded = taskMetrics.filter((m) => m.event === "task_completed" || m.event === "review_completed").length;
  const failed = totalTasks - succeeded;
  const successRate = totalTasks > 0 ? Math.round((succeeded / totalTasks) * 100) : null;
  const totalCost = taskMetrics.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  const durations = taskMetrics.map((m) => m.duration).filter((d): d is number => d != null && !Number.isNaN(d));
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Recent activity (last 50)
  const recentActivity = taskMetrics.slice(-50).reverse();

  // Chart data
  const dailyStats = computeDailyStats(allMetrics, 14);
  const rawMaxTasks = Math.max(1, ...dailyStats.map((d) => d.completed + d.failed));
  const maxTasksPerDay = niceMax(rawMaxTasks, false);
  const rawMaxCost = Math.max(0.01, ...dailyStats.map((d) => d.cost));
  const maxCostPerDay = niceMax(rawMaxCost, true);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Critters Dashboard</title>
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
    .header .version { color: var(--text-dim); font-size: 0.85rem; }
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

    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
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
    .bar-label { font-size: 0.6rem; color: var(--text-dim); margin-top: 4px; white-space: nowrap; }
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
    .status-ok { color: var(--success); font-weight: 600; }
    .status-fail { color: var(--failure); font-weight: 600; }
    a { color: #5dade2; text-decoration: none; }
    a:hover { text-decoration: underline; }

    @media (max-width: 600px) {
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
    <span class="version">${escapeHtml(getDisplayVersion())}</span>
  </div>

  <div class="summary">
    <div class="card">
      <div class="label">Total Tasks</div>
      <div class="value">${totalTasks}</div>
      <div class="sub">${succeeded} succeeded, ${failed} failed</div>
    </div>
    <div class="card">
      <div class="label">Success Rate</div>
      <div class="value">${successRate != null ? `${successRate}%` : "N/A"}</div>
    </div>
    <div class="card">
      <div class="label">Total Cost</div>
      <div class="value">${formatCost(totalCost)}</div>
    </div>
    <div class="card">
      <div class="label">Avg Duration</div>
      <div class="value">${avgDuration != null ? fmtDuration(avgDuration) : "N/A"}</div>
    </div>
  </div>

  <div class="active-section">
    <h2>Active Critters</h2>
    <div class="active-grid">
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
    </div>
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
${dailyStats
  .map((d) => {
    const successH = Math.round(((d.completed) / maxTasksPerDay) * 100);
    const failH = Math.round(((d.failed) / maxTasksPerDay) * 100);
    const label = d.date.slice(5);
    const shortDate = formatShortDate(d.date);
    return `          <div class="bar-group" data-tooltip="${shortDate}: ${d.completed} completed, ${d.failed} failed">
            <div class="bar-stack">
              <div class="bar failure" style="height:${failH}%"${failH > 0 ? ` data-tooltip="${d.failed} failed"` : ""}></div>
              <div class="bar success" style="height:${successH}%"${successH > 0 ? ` data-tooltip="${d.completed} completed"` : ""}></div>
            </div>
            <div class="bar-label">${escapeHtml(label)}</div>
          </div>`;
  })
  .join("\n")}
        </div>
      </div>
    </div>
    <div class="chart-card">
      <h3>Cost per Day (Last 14 Days)</h3>
      <div class="chart-with-axis">
        <div class="y-axis">
          <span class="y-label">$${maxCostPerDay.toFixed(2)}</span>
          <span class="y-label">$${(maxCostPerDay / 2).toFixed(2)}</span>
          <span class="y-label">$0</span>
        </div>
        <div class="bar-chart">
${dailyStats
  .map((d) => {
    const h = Math.round((d.cost / maxCostPerDay) * 100);
    const label = d.date.slice(5);
    const shortDate = formatShortDate(d.date);
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
      <h3>Success vs Failure</h3>
      <div class="bar-chart" style="justify-content:center;gap:32px;">
        <div class="bar-group" style="max-width:80px;">
          <div class="bar-stack">
            <div class="bar success" style="height:${totalTasks > 0 ? Math.round((succeeded / totalTasks) * 100) : 0}%" data-tooltip="${succeeded} succeeded"></div>
          </div>
          <div class="bar-label">Pass (${succeeded})</div>
        </div>
        <div class="bar-group" style="max-width:80px;">
          <div class="bar-stack">
            <div class="bar failure" style="height:${totalTasks > 0 ? Math.round((failed / totalTasks) * 100) : 0}%" data-tooltip="${failed} failed"></div>
          </div>
          <div class="bar-label">Fail (${failed})</div>
        </div>
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
            <th>Status</th>
            <th>Duration</th>
            <th>Cost</th>
            <th>PR</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
${recentActivity.length === 0 ? '          <tr><td colspan="6" style="text-align:center;color:var(--text-dim);">No activity yet</td></tr>' : recentActivity
  .map((m) => {
    const id = escapeHtml(m.identifier ?? m.issueId ?? "\u2014");
    const isReview = m.event === "review_completed" || m.event === "review_failed";
    const isOk = m.event === "task_completed" || m.event === "review_completed";
    const statusClass = isOk ? "status-ok" : "status-fail";
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
            <td class="${statusClass}">${statusText}</td>
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
