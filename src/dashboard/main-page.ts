import type { HealthStatus } from "../health.js";
import { getRecentMetrics } from "../metrics.js";
import type { PrStatus } from "../pr-status.js";
import { getDisplayVersion } from "../updater.js";
import {
  computeDailyStats,
  escapeHtml,
  fmtAgoShort,
  fmtDuration,
  fmtDurationShort,
  formatCost,
  formatDate,
  getDateKey,
  inferType,
  renderPrStatusIcons,
} from "./helpers.js";

function phaseLabel(phase: string): string {
  if (phase === "plan" || phase === "planning") return "Planning";
  if (phase === "exec" || phase === "execution") return "Execution";
  if (phase === "review") return "Reviewing";
  if (phase === "fix") return "Fixing";
  if (phase === "audit") return "Auditing";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function typeSwatch(type: string): string {
  // CSS custom prop name — stable colors per critter type
  switch (type) {
    case "create": return "var(--accent)";
    case "review": return "var(--sky)";
    case "fix-review-comments": return "var(--violet)";
    case "code-audit": return "var(--green)";
    case "docs-writer": return "var(--rose)";
    default: return "var(--fg-3)";
  }
}

function sparklinePath(data: number[], width: number, height: number): { line: string; area: string } {
  if (data.length === 0) return { line: "", area: "" };
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });
  const line = pts.map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area };
}

function sparklineSvg(data: number[], width = 80, height = 24, color = "var(--accent)"): string {
  const { line, area } = sparklinePath(data, width, height);
  if (!line) return "";
  return `<svg width="${width}" height="${height}" style="display:block" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity="0.12" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function renderDashboard(_metricsPath: string, status: HealthStatus, uptime: number, typeFilter?: string, dashboardToken?: string, prStatuses?: Map<string, PrStatus>): string {
  const allMetrics = getRecentMetrics(10000);
  const allTypes = [...new Set(allMetrics.map(m => inferType(m)).filter(Boolean))].sort();
  const filteredMetrics = typeFilter ? allMetrics.filter(m => inferType(m) === typeFilter) : allMetrics;

  const taskMetrics = filteredMetrics.filter(
    (m) => m.event === "task_completed" || m.event === "task_failed" ||
           m.event === "review_completed" || m.event === "review_failed",
  );

  const totalTasks = taskMetrics.length;
  const succeeded = taskMetrics.filter((m) => m.event === "task_completed" || m.event === "review_completed").length;
  const successRate = totalTasks > 0 ? Math.round((succeeded / totalTasks) * 100) : null;
  const totalCost = taskMetrics.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  const avgCost = totalTasks > 0 ? totalCost / totalTasks : null;
  const durations = taskMetrics.map((m) => m.duration).filter((d): d is number => d != null && !Number.isNaN(d));
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Per-type aggregate
  const perTypeStats = new Map<string, { total: number; succeeded: number; totalCost: number; durations: number[] }>();
  for (const m of taskMetrics) {
    const typeName = inferType(m);
    let entry = perTypeStats.get(typeName);
    if (!entry) {
      entry = { total: 0, succeeded: 0, totalCost: 0, durations: [] };
      perTypeStats.set(typeName, entry);
    }
    entry.total++;
    if (m.event === "task_completed" || m.event === "review_completed") entry.succeeded++;
    entry.totalCost += m.costUsd ?? 0;
    if (m.duration != null && !Number.isNaN(m.duration)) entry.durations.push(m.duration);
  }

  // Daily stats for throughput chart + sparklines
  const dailyStats = computeDailyStats(filteredMetrics, 14);
  const last7 = dailyStats.slice(-7);
  const sparkTasks = last7.map(d => d.completed + d.failed);
  const sparkCost = last7.map(d => Math.round(d.cost * 100) / 100);
  const maxThroughput = Math.max(1, ...dailyStats.map(d => d.completed + d.failed));

  // Recent activity (last 50)
  const recentActivity = taskMetrics.slice(-50).reverse();
  const activityTypes = [...new Set(recentActivity.map(m => inferType(m)))].sort();

  // Active and queued critters
  const activeDetails = status.activeCritterDetails;
  const queuedDetails = status.queuedCritterDetails;

  const pollAgo = status.lastPollAt ? formatDate(status.lastPollAt) : "never";
  const concurrencyActive = Object.values(status.perType).reduce((sum, c) => sum + c.active, 0);

  const selectedId = activeDetails[0]?.identifier ?? null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <noscript><meta http-equiv="refresh" content="30;url=${typeFilter ? `/dashboard?type=${encodeURIComponent(typeFilter)}` : `/dashboard`}"></noscript>
  <title>Critters Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x1F41B;</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --sans: "Inter", system-ui, -apple-system, sans-serif;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

      --bg: oklch(0.16 0.008 80);
      --surface: oklch(0.195 0.008 80);
      --surface-2: oklch(0.235 0.009 80);
      --border: oklch(0.28 0.008 80);
      --border-subtle: oklch(0.235 0.008 80);
      --track: oklch(0.245 0.008 80);
      --fg: oklch(0.96 0.005 80);
      --fg-2: oklch(0.78 0.008 80);
      --fg-3: oklch(0.58 0.008 80);

      --accent: oklch(0.78 0.14 75);
      --green: oklch(0.74 0.14 150);
      --danger: oklch(0.68 0.19 25);
      --sky: oklch(0.76 0.11 230);
      --violet: oklch(0.72 0.14 300);
      --amber: oklch(0.8 0.14 90);
      --rose: oklch(0.72 0.15 10);

      --terminal-bg: oklch(0.135 0.008 80);
      --terminal-fg: oklch(0.92 0.008 80);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
    body { min-height: 100vh; font-size: 14px; line-height: 1.5; }
    h1, h2, h3, h4 { margin: 0; font-weight: 600; color: var(--fg); }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    button { font-family: inherit; }
    code { font-family: var(--mono); font-size: 12px; color: var(--fg-2); }

    .app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }

    .sidebar {
      border-right: 1px solid var(--border);
      padding: 20px 18px;
      position: sticky; top: 0; height: 100vh;
      display: flex; flex-direction: column; gap: 20px;
      background: var(--surface);
      overflow-y: auto;
    }
    .sidebar .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
    .sidebar .brand .ver { font-family: var(--mono); font-size: 10px; color: var(--fg-3); font-weight: 500; }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    .nav-group .label { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg-3); font-family: var(--mono); padding: 0 8px 6px; }
    .nav-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; color: var(--fg-2); font-size: 13px; cursor: pointer; text-decoration: none; }
    .nav-item:hover { background: var(--surface-2); color: var(--fg); text-decoration: none; }
    .nav-item.active { background: var(--surface-2); color: var(--fg); }
    .nav-item .count { margin-left: auto; font-family: var(--mono); font-size: 10px; color: var(--fg-3); }
    .daemon-card {
      margin-top: auto; padding: 12px;
      background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
      font-family: var(--mono); font-size: 11px; color: var(--fg-2);
      display: flex; flex-direction: column; gap: 4px;
    }
    .daemon-card .row { display: flex; justify-content: space-between; gap: 8px; }
    .daemon-card .row .l { color: var(--fg-3); }

    .main { display: flex; flex-direction: column; min-width: 0; }
    .topbar { display: flex; align-items: center; gap: 14px; padding: 14px 28px; border-bottom: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; z-index: 10; white-space: nowrap; flex-wrap: wrap; }
    .topbar h1 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    .topbar .breadcrumb { color: var(--fg-3); font-family: var(--mono); font-size: 12px; }
    .topbar .spacer { flex: 1; }
    .topbar .meta { font-family: var(--mono); font-size: 11px; color: var(--fg-3); }
    .topbar .btn { font-family: var(--mono); font-size: 12px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--fg); cursor: pointer; }
    .topbar .btn:hover { border-color: var(--fg-3); }
    .topbar .btn.primary { background: var(--accent); color: var(--bg); border-color: transparent; font-weight: 600; }
    .topbar .btn:disabled { opacity: 0.6; cursor: default; }
    .topbar .btn.icon { padding: 6px 10px; position: relative; }

    .content { padding: 20px 28px 40px; max-width: 1480px; width: 100%; margin: 0 auto; min-width: 0; }

    .type-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }

    .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; position: relative; }
    .dot.pulse::after {
      content: ""; position: absolute; inset: 0; border-radius: 50%;
      background: currentColor; opacity: 0.3; animation: pulse 1.6s ease-out infinite;
    }
    @keyframes pulse { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.4); opacity: 0; } }
    @keyframes blink { 50% { opacity: 0; } }

    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500;
      font-family: var(--mono); letter-spacing: 0.01em;
      color: var(--fg-2);
      background: var(--surface-2);
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .pill.live { color: var(--accent); border-color: color-mix(in oklch, var(--accent) 35%, transparent); }

    .progress { background: var(--track); height: 2px; border-radius: 1px; overflow: hidden; width: 100%; }
    .progress > .bar { height: 100%; background: var(--accent); transition: width 300ms ease; }

    /* KPI strip */
    .kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; position: relative; }
    .kpi .label { display: flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); font-family: var(--mono); }
    .kpi .value-row { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; }
    .kpi .value { font-size: 26px; font-weight: 500; font-family: var(--mono); letter-spacing: -0.01em; }
    .kpi .spark { flex: 1; display: flex; justify-content: flex-end; opacity: 0.7; }
    .kpi .sub { font-size: 11px; color: var(--fg-3); margin-top: 4px; font-family: var(--mono); }

    /* Live hero */
    .live-hero { display: grid; grid-template-columns: 380px 1fr; gap: 0; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; min-height: 420px; }
    .active-col { border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    .tail-col { display: flex; flex-direction: column; background: var(--terminal-bg); min-width: 0; }
    .section-header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
    .section-header h3 { font-size: 13px; font-weight: 600; }
    .section-header .count { font-family: var(--mono); font-size: 11px; color: var(--fg-3); }
    .section-header .spacer { flex: 1; }
    .active-scroll { overflow-y: auto; flex: 1; }
    .active-row { padding: 10px 16px; border-left: 2px solid transparent; border-bottom: 1px solid var(--border-subtle); cursor: pointer; }
    .active-row.selected { background: var(--surface-2); }
    .active-row .ar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .active-row .ar-id { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--fg); }
    .active-row .ar-title { font-size: 12px; color: var(--fg-2); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .active-row .ar-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .active-row .ar-elapsed { font-family: var(--mono); font-size: 11px; color: var(--fg-3); }
    .active-row .ar-elapsed.danger { color: var(--danger); }
    .active-row .ar-cost { font-family: var(--mono); font-size: 10px; color: var(--fg-3); margin-left: auto; }
    .queued-header { padding: 10px 16px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); font-family: var(--mono); border-top: 1px dashed var(--border); margin-top: 4px; }
    .queued-row { padding: 10px 16px; font-size: 12px; display: flex; align-items: center; gap: 8px; color: var(--fg-2); border-bottom: 1px solid var(--border-subtle); }
    .queued-row .qr-id { font-family: var(--mono); font-weight: 600; }
    .queued-row .qr-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued-row .qr-wait { font-family: var(--mono); color: var(--fg-3); font-size: 11px; }
    .empty-state { padding: 32px 16px; text-align: center; color: var(--fg-3); font-size: 13px; font-family: var(--mono); }
    .empty-state .icon { display: block; font-size: 24px; margin-bottom: 8px; }

    .tail-head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; font-family: var(--mono); font-size: 12px; background: var(--surface); flex-wrap: wrap; }
    .tail-head strong { color: var(--fg); }
    .tail-head .dim { color: var(--fg-3); }
    .tail-body { flex: 1; padding: 12px 16px; overflow-y: auto; font-family: var(--mono); font-size: 12px; line-height: 1.6; color: var(--terminal-fg); min-height: 280px; max-height: 560px; }
    .tail-body .ln { margin-bottom: 4px; display: flex; gap: 10px; }
    .tail-body .ln .ts { color: var(--fg-3); min-width: 44px; opacity: 0.6; flex-shrink: 0; }
    .tail-body .ln .txt { flex: 1; white-space: pre-wrap; word-break: break-word; }
    .tail-body .ln.tool .txt { color: var(--sky); }
    .tail-body .ln.assistant .txt { color: var(--accent); }
    .tail-body .cursor { color: var(--fg-3); animation: blink 1s steps(2) infinite; }
    .tail-foot { padding: 10px 16px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 12px; background: var(--surface); font-family: var(--mono); font-size: 11px; color: var(--fg-3); flex-wrap: wrap; }
    .tail-foot .br { color: var(--fg-2); }
    .tail-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--fg-3); font-family: var(--mono); font-size: 13px; }

    /* Lower grid */
    .lower-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
    .card { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
    .card .body { padding: 18px; }
    .side-col { display: flex; flex-direction: column; gap: 16px; }

    .card h3 { font-size: 13px; font-weight: 600; }
    .card .chart-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
    .card .chart-head .meta { font-family: var(--mono); font-size: 11px; color: var(--fg-3); }

    /* Activity */
    .activity-filterbar { padding: 12px 18px; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .chip {
      font-family: var(--mono); font-size: 11px; padding: 3px 9px; border-radius: 999px;
      border: 1px solid var(--border); background: transparent; color: var(--fg-2);
      cursor: pointer; text-transform: lowercase;
    }
    .chip:hover { border-color: var(--fg-3); color: var(--fg); }
    .chip.active { background: var(--fg); color: var(--bg); border-color: var(--fg-2); }
    .activity-search {
      font-family: var(--mono); font-size: 12px; padding: 4px 10px;
      background: var(--bg); border: 1px solid var(--border); color: var(--fg);
      border-radius: 6px; width: 160px;
    }
    .activity-table-wrap { overflow-x: auto; }
    table.activity { width: 100%; border-collapse: collapse; font-size: 12px; }
    table.activity th { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); font-weight: 600; padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); }
    table.activity td { padding: 10px 16px; vertical-align: middle; border-top: 1px solid var(--border-subtle); }
    table.activity th.num, table.activity td.num { text-align: right; }
    table.activity tr:hover td { background: oklch(0.22 0.008 80); }
    table.activity .id { font-family: var(--mono); font-weight: 600; }
    table.activity .title { margin-left: 8px; color: var(--fg-2); }
    table.activity .repo { font-family: var(--mono); color: var(--fg-2); }
    table.activity .when { font-family: var(--mono); color: var(--fg-3); }
    table.activity .dur, table.activity .cost { font-family: var(--mono); color: var(--fg-2); }
    table.activity .status { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; }
    table.activity .status.ok { color: var(--green); }
    table.activity .status.fail { color: var(--danger); }
    table.activity [data-sortable] { cursor: pointer; user-select: none; }
    table.activity [data-sortable]:hover { color: var(--fg-2); }

    /* Throughput bars */
    .throughput-bars { display: flex; align-items: flex-end; gap: 4px; height: 100px; }
    .throughput-bars .bar-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; cursor: default; }
    .throughput-bars .bar-col .ok { background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.9; }
    .throughput-bars .bar-col .bad { background: var(--danger); }
    .throughput-axis { display: flex; justify-content: space-between; margin-top: 8px; font-family: var(--mono); font-size: 10px; color: var(--fg-3); }

    /* Type breakdown */
    .type-rows { display: flex; flex-direction: column; gap: 10px; }
    .type-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
    .type-row .name { font-family: var(--mono); width: 140px; color: var(--fg); }
    .type-row .track { flex: 1; }
    .type-row .rate { font-family: var(--mono); color: var(--fg-2); width: 46px; text-align: right; }
    .type-row .total { font-family: var(--mono); color: var(--fg-3); width: 40px; text-align: right; }

    .pr-status { font-size: 11px; margin-left: 4px; }

    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--fg-3); }

    /* Create modal */
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; align-items: center; justify-content: center; }
    .modal-backdrop.open { display: flex; }
    .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; max-width: 500px; width: 90%; padding: 24px; }
    .modal h2 { font-size: 15px; margin-bottom: 16px; }
    .modal label { display: block; font-size: 11px; color: var(--fg-3); margin-bottom: 4px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.05em; }
    .modal input, .modal select, .modal textarea {
      width: 100%; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      color: var(--fg); font-size: 13px; font-family: var(--sans);
    }
    .modal textarea { resize: vertical; font-family: var(--mono); font-size: 12px; }
    .modal .field { margin-bottom: 12px; }
    .modal .actions { display: flex; gap: 8px; justify-content: flex-end; }
    .modal .btn { font-family: var(--mono); font-size: 12px; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--fg); cursor: pointer; }
    .modal .btn.primary { background: var(--accent); color: var(--bg); border-color: transparent; font-weight: 600; }
    .modal .error { display: none; background: color-mix(in oklch, var(--danger) 15%, transparent); border: 1px solid var(--danger); color: var(--danger); padding: 8px 10px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }
    .modal .success { display: none; background: color-mix(in oklch, var(--green) 15%, transparent); border: 1px solid var(--green); color: var(--green); padding: 8px 10px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }

    .auth-prompt { display: none; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; margin-bottom: 16px; font-size: 13px; }
    .auth-prompt input { background: var(--bg); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 6px; font-size: 12px; margin: 0 8px; }
    .auth-prompt .btn { font-family: var(--mono); font-size: 12px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--fg); cursor: pointer; }

    @media (max-width: 980px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: relative; height: auto; }
      .kpi-strip { grid-template-columns: repeat(2, 1fr); }
      .live-hero { grid-template-columns: 1fr; }
      .active-col { border-right: none; border-bottom: 1px solid var(--border); }
      .lower-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="11" r="5" fill="var(--accent)" opacity="0.95" />
          <circle cx="10" cy="6" r="2.2" fill="var(--accent)" />
          <line x1="8.5" y1="4.5" x2="6" y2="2.5" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
          <line x1="11.5" y1="4.5" x2="14" y2="2.5" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
          <line x1="4" y1="10" x2="1.5" y2="9" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
          <line x1="16" y1="10" x2="18.5" y2="9" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
          <line x1="4.5" y1="13" x2="2" y2="15" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
          <line x1="15.5" y1="13" x2="18" y2="15" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        critters
        <span class="ver">${escapeHtml(getDisplayVersion())}</span>
      </div>

      <div class="nav-group">
        <div class="label">Monitor</div>
        <a class="nav-item active" href="#top"><span class="dot pulse" style="color:var(--accent)"></span> Dashboard</a>
        <a class="nav-item" href="#active-section">In flight <span class="count">${activeDetails.length}</span></a>
        <a class="nav-item" href="#active-section">Queue <span class="count">${queuedDetails.length}</span></a>
        <a class="nav-item" href="#activity-section">History</a>
      </div>

      <div class="nav-group">
        <div class="label">Insights</div>
        <a class="nav-item" href="/dashboard/release-notes">Release notes</a>
      </div>

      <div class="daemon-card">
        <div class="row"><span class="l">status</span><span style="color:var(--green)"><span class="dot" style="color:var(--green)"></span> healthy</span></div>
        <div class="row"><span class="l">uptime</span><span>${fmtDuration(uptime)}</span></div>
        <div class="row"><span class="l">poll</span><span>every ${status.pollIntervalSeconds}s</span></div>
        <div class="row"><span class="l">last</span><span>${escapeHtml(pollAgo)}</span></div>
        <div class="row"><span class="l">slots</span><span>${concurrencyActive}/${status.concurrencyMax}</span></div>
      </div>
    </aside>

    <main class="main">
      <div class="topbar" id="top">
        <h1>Console</h1>
        <span class="breadcrumb">· critters daemon${typeFilter ? ` · type: ${escapeHtml(typeFilter)}` : ""}</span>
        <span class="spacer"></span>
        <span class="meta" id="refresh-countdown">Refreshing in 30s</span>
        <button class="btn" id="poll-btn">Poll now</button>
        <button class="btn primary" id="new-critter-btn">+ New critter</button>
        <button class="btn icon" id="notif-btn" title="Enable browser notifications">
          &#x1F514;
          <span id="notif-dot" style="display:none;position:absolute;top:2px;right:4px;width:6px;height:6px;background:var(--green);border-radius:50%;"></span>
        </button>
      </div>

      <div class="content">
        <div id="auth-prompt" class="auth-prompt">
          <span style="color:var(--fg-3)">Dashboard token required:</span>
          <input type="password" id="auth-token-input" placeholder="Enter token">
          <button class="btn" id="auth-save-btn">Save</button>
        </div>

${allTypes.length >= 2 ? `        <div class="type-filters">
          <a href="/dashboard" class="chip${!typeFilter ? " active" : ""}">all</a>
${allTypes.map(t => `          <a href="/dashboard?type=${encodeURIComponent(t)}" class="chip${typeFilter === t ? " active" : ""}">${escapeHtml(t)}</a>`).join("\n")}
        </div>` : ""}

        <!-- KPI strip -->
        <div class="kpi-strip">
          <div class="kpi">
            <div class="label"><span class="dot pulse" style="color:var(--accent)"></span> In flight</div>
            <div class="value-row"><div class="value">${activeDetails.length}</div></div>
            <div class="sub">${queuedDetails.length} queued</div>
          </div>
          <div class="kpi">
            <div class="label">Success · 14d</div>
            <div class="value-row">
              <div class="value">${successRate != null ? `${successRate}%` : "N/A"}</div>
              <div class="spark">${sparkTasks.length ? sparklineSvg(sparkTasks) : ""}</div>
            </div>
            <div class="sub">${succeeded}/${totalTasks} tasks</div>
          </div>
          <div class="kpi">
            <div class="label">Spend · 14d</div>
            <div class="value-row">
              <div class="value">${formatCost(totalCost)}</div>
              <div class="spark">${sparkCost.length ? sparklineSvg(sparkCost) : ""}</div>
            </div>
            <div class="sub">${avgCost != null && totalTasks > 0 ? `avg ${formatCost(avgCost)}/run` : "no runs"}</div>
          </div>
          <div class="kpi">
            <div class="label">Avg duration</div>
            <div class="value-row"><div class="value">${avgDuration != null ? fmtDuration(avgDuration) : "N/A"}</div></div>
            <div class="sub">planning + execution</div>
          </div>
        </div>

        <!-- Live hero -->
        <div class="live-hero" id="active-section">
          <div class="active-col">
            <div class="section-header">
              <h3>Active</h3>
              <span class="count">${activeDetails.length}</span>
              <span class="spacer"></span>
              ${activeDetails.length > 0 ? `<span class="pill live"><span class="dot pulse" style="color:var(--accent)"></span> live</span>` : ""}
            </div>
            <div class="active-scroll" id="active-scroll">
${activeDetails.length === 0 && queuedDetails.length === 0 ? `              <div class="empty-state"><span class="icon">&#x1F997;</span>No active critters — all quiet</div>` : ""}
${activeDetails.map((d, i) => {
  const elapsed = Date.now() - d.startedAt;
  const timeoutMs = (d.timeoutMinutes ?? 30) * 60 * 1000;
  const pct = Math.min(1, elapsed / timeoutMs);
  const danger = pct > 0.8;
  const type = d.critterType ?? "create";
  const color = typeSwatch(type);
  const costStr = d.costUsd != null ? (d.costBudget ? `${formatCost(d.costUsd)} / ${formatCost(d.costBudget)}` : formatCost(d.costUsd)) : "";
  return `              <div class="active-row${i === 0 ? " selected" : ""}" data-id="${escapeHtml(d.identifier)}" data-phase="${escapeHtml(d.phase)}" data-repo="${escapeHtml(d.repo)}" data-branch="${escapeHtml(d.branch)}" data-type="${escapeHtml(type)}" data-pr="${d.prUrl ? escapeHtml(d.prUrl) : ""}" style="border-left-color: ${i === 0 ? color : "transparent"}">
                <div class="ar-head">
                  <span class="dot pulse" style="color: ${color}"></span>
                  <span class="ar-id">${escapeHtml(d.identifier)}</span>
                  <span class="spacer" style="flex:1"></span>
                  <span class="ar-elapsed${danger ? " danger" : ""}">${fmtDurationShort(elapsed)}</span>
                </div>
                <div class="ar-title">${escapeHtml(d.title)}</div>
                <div class="ar-meta">
                  <span class="pill" style="color: ${color}; border-color: color-mix(in oklch, ${color} 35%, transparent)">${escapeHtml(phaseLabel(d.phase))}</span>
                  <span class="pill">${escapeHtml(type)}</span>
                  <span class="ar-cost">${escapeHtml(costStr)}</span>
                </div>
                <div class="progress"><div class="bar" style="width: ${(pct * 100).toFixed(1)}%; background: ${danger ? "var(--danger)" : color}"></div></div>
              </div>`;
}).join("\n")}
${queuedDetails.length > 0 ? `              <div class="queued-header">Queued · ${queuedDetails.length}</div>
${queuedDetails.map(q => `              <div class="queued-row">
                <span class="dot" style="color:var(--fg-3)"></span>
                <span class="qr-id">${escapeHtml(q.identifier)}</span>
                <span class="qr-title">${escapeHtml(q.title)}</span>
                <span class="qr-wait">${fmtAgoShort(q.enqueuedAt)}</span>
              </div>`).join("\n")}` : ""}
            </div>
          </div>
          <div class="tail-col" id="tail-col">
${selectedId ? renderTailShell() : `            <div class="tail-empty">nothing to tail — all quiet</div>`}
          </div>
        </div>

        <!-- Lower grid -->
        <div class="lower-grid">
          <div class="card">
            <div class="activity-filterbar" id="activity-filterbar">
              <h3 style="font-size: 13px; font-weight: 600;">Recent activity</h3>
              <span class="count" style="font-family:var(--mono); font-size:11px; color:var(--fg-3)">${recentActivity.length} total</span>
              <span class="spacer" style="flex:1"></span>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="chip active" data-filter-group="type" data-filter-value="">all</button>
${activityTypes.map(t => `                <button class="chip" data-filter-group="type" data-filter-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("\n")}
              </div>
              <div style="display:flex;gap:4px">
                <button class="chip active" data-filter-group="status" data-filter-value="">all</button>
                <button class="chip" data-filter-group="status" data-filter-value="ok">ok</button>
                <button class="chip" data-filter-group="status" data-filter-value="fail">fail</button>
              </div>
              <input type="text" class="activity-search" id="activity-search" placeholder="filter…">
            </div>
            <div class="activity-table-wrap">
              <table class="activity">
                <thead>
                  <tr>
                    <th data-sortable="string">Issue</th>
                    <th data-sortable="string">Type</th>
                    <th data-sortable="string">Repo</th>
                    <th data-sortable="string">Status</th>
                    <th class="num" data-sortable="duration">Duration</th>
                    <th class="num" data-sortable="cost">Cost</th>
                    <th>PR</th>
                    <th class="num" data-sortable="date">When</th>
                  </tr>
                </thead>
                <tbody>
${recentActivity.length === 0 ? `                  <tr><td colspan="8" class="empty-state"><span class="icon">&#x1F4CB;</span>No activity yet</td></tr>` : recentActivity.map((m) => {
  const id = escapeHtml(m.identifier ?? m.issueId ?? "\u2014");
  const typeName = inferType(m);
  const isReview = m.event === "review_completed" || m.event === "review_failed";
  const isOk = m.event === "task_completed" || m.event === "review_completed";
  const statusText = isReview ? (isOk ? "reviewed" : "review·fail") : (isOk ? "shipped" : "failed");
  const dur = fmtDuration(m.duration);
  const cost = formatCost(m.costUsd);
  const pr = m.prUrl
    ? `<a href="${escapeHtml(m.prUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">PR</a>${renderPrStatusIcons(m.prUrl, prStatuses)}`
    : `<span style="color:var(--fg-3)">\u2014</span>`;
  const when = formatDate(m.timestamp);
  const rawId = m.identifier ?? m.issueId ?? "";
  const issueHref = m.issueUrl ? escapeHtml(m.issueUrl) : `/dashboard/${encodeURIComponent(rawId)}`;
  const issueTarget = m.issueUrl ? ' target="_blank" rel="noopener"' : "";
  const repoShort = (m.repoUrl ?? "").split("/").pop()?.replace(/\.git$/, "") ?? "";
  return `                  <tr data-type="${escapeHtml(typeName)}" data-status="${isOk ? "ok" : "fail"}" data-date="${getDateKey(m.timestamp)}">
                    <td><a href="${issueHref}"${issueTarget} class="id" onclick="event.stopPropagation()">${id}</a></td>
                    <td><span class="pill" style="color: ${typeSwatch(typeName)}">${escapeHtml(typeName)}</span></td>
                    <td class="repo">${escapeHtml(repoShort)}</td>
                    <td><span class="status ${isOk ? "ok" : "fail"}"><span class="dot" style="color: ${isOk ? "var(--green)" : "var(--danger)"}"></span>${statusText}</span></td>
                    <td class="dur num" data-sort-value="${m.duration ?? -1}">${dur}</td>
                    <td class="cost num" data-sort-value="${m.costUsd ?? -1}">${cost}</td>
                    <td>${pr}</td>
                    <td class="when num" data-sort-value="${m.timestamp}">${when}</td>
                  </tr>`;
}).join("\n")}
                </tbody>
              </table>
            </div>
            <div id="activity-section" style="padding: 12px 18px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px;">
              <span id="activity-counter" style="font-family:var(--mono); font-size: 11px; color: var(--fg-3)"></span>
              <span class="spacer" style="flex:1"></span>
              <button class="chip" id="clear-filters-btn" style="display:none">Clear filters</button>
            </div>
          </div>

          <div class="side-col">
            <div class="card">
              <div class="body">
                <div class="chart-head">
                  <h3>Throughput</h3>
                  <span class="meta">tasks / day · 14d</span>
                </div>
                <div class="throughput-bars">
${dailyStats.map((d) => {
  const total = d.completed + d.failed;
  const totalH = (total / maxThroughput) * 100;
  const failH = (d.failed / maxThroughput) * 100;
  const okH = totalH - failH;
  return `                  <div class="bar-col" title="${d.date} · ${d.completed} ok / ${d.failed} fail">
                    <div class="ok" style="height: ${okH.toFixed(1)}px"></div>
                    <div class="bad" style="height: ${failH.toFixed(1)}px"></div>
                  </div>`;
}).join("\n")}
                </div>
                <div class="throughput-axis">
                  <span>${dailyStats[0]?.date.slice(5) ?? ""}</span>
                  <span>${dailyStats[dailyStats.length - 1]?.date.slice(5) ?? ""}</span>
                </div>
              </div>
            </div>

${perTypeStats.size > 0 ? `            <div class="card">
              <div class="body">
                <div class="chart-head" style="margin-bottom: 14px;"><h3>By type</h3></div>
                <div class="type-rows">
${[...perTypeStats.entries()].sort((a, b) => b[1].total - a[1].total).map(([typeName, s]) => {
  const rate = s.total > 0 ? Math.round((s.succeeded / s.total) * 100) : 0;
  const color = typeSwatch(typeName);
  return `                  <div class="type-row">
                    <span class="dot" style="color: ${color}; width:8px; height:8px"></span>
                    <span class="name">${escapeHtml(typeName)}</span>
                    <span class="track"><div class="progress" style="height:4px"><div class="bar" style="width: ${rate}%; background: ${color}"></div></div></span>
                    <span class="rate">${rate}%</span>
                    <span class="total">${s.total}</span>
                  </div>`;
}).join("\n")}
                </div>
              </div>
            </div>` : ""}
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Create modal -->
  <div id="create-modal" class="modal-backdrop">
    <div class="modal">
      <h2>Create Critter Ticket</h2>
      <div id="create-error" class="error"></div>
      <div id="create-success" class="success"></div>
      <form id="create-form">
        <div class="field" id="create-provider-wrap">
          <label>Provider</label>
          <select id="create-provider"></select>
        </div>
        <div class="field">
          <label>Team / Project</label>
          <select id="create-team" required></select>
        </div>
        <div class="field">
          <label>Critter type</label>
          <select id="create-type"></select>
        </div>
        <div class="field" id="create-repo-wrap">
          <label>Repository</label>
          <select id="create-repo">
            <option value="">None (specify in description)</option>
          </select>
        </div>
        <div class="field">
          <label>Base branch <span style="text-transform:none;color:var(--fg-3)">(optional)</span></label>
          <input type="text" id="create-branch" placeholder="e.g. dev, beta (defaults to repo default branch)">
        </div>
        <div class="field">
          <label>Title</label>
          <input type="text" id="create-title" required placeholder="Issue title">
        </div>
        <div class="field">
          <label>Description</label>
          <textarea id="create-description" rows="6" placeholder="Include repo: git@github.com:org/repo.git on its own line if no project mapping exists"></textarea>
        </div>
        <div class="actions">
          <button type="button" class="btn" id="create-cancel">Cancel</button>
          <button type="submit" class="btn primary" id="create-submit">Create</button>
        </div>
      </form>
    </div>
  </div>

<script>
var __dashboardToken = ${dashboardToken ? JSON.stringify(dashboardToken) : "null"};
var __activeIds = ${JSON.stringify(activeDetails.map(d => d.identifier))};
var __paused = false;

function getAuthHeaders() {
  var token = __dashboardToken || localStorage.getItem('critters-token');
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function showAuthPrompt() {
  var p = document.getElementById('auth-prompt');
  if (p) p.style.display = 'block';
}

// --- Auth prompt
(function() {
  var saveBtn = document.getElementById('auth-save-btn');
  var input = document.getElementById('auth-token-input');
  if (!saveBtn || !input) return;
  saveBtn.addEventListener('click', function() {
    var val = input.value.trim();
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

// --- Active critter selection + live tail
(function() {
  var scroll = document.getElementById('active-scroll');
  var tailCol = document.getElementById('tail-col');
  if (!scroll || !tailCol) return;

  var currentId = __activeIds[0] || null;
  var pollTimer = null;

  function renderTailShell(row) {
    var phase = row.dataset.phase;
    var phaseLabel = phase === 'plan' || phase === 'planning' ? 'Planning'
      : phase === 'exec' || phase === 'execution' ? 'Execution'
      : phase === 'review' ? 'Reviewing'
      : phase === 'fix' ? 'Fixing'
      : phase === 'audit' ? 'Auditing'
      : phase.charAt(0).toUpperCase() + phase.slice(1);
    var pr = row.dataset.pr;
    tailCol.innerHTML =
      '<div class="tail-head">'
      + '<span class="dim">tail —</span>'
      + '<strong>' + row.dataset.id + '</strong>'
      + '<span class="dim">·</span>'
      + '<span>' + row.dataset.repo + '</span>'
      + '<span class="dim">·</span>'
      + '<span>' + phaseLabel + '</span>'
      + '</div>'
      + '<div class="tail-body" id="tail-body">'
      + '<div class="tail-empty">loading…</div>'
      + '</div>'
      + '<div class="tail-foot">'
      + '<span>branch <span class="br">' + row.dataset.branch + '</span></span>'
      + '<span style="flex:1"></span>'
      + (pr ? '<a href="' + pr + '" target="_blank" rel="noopener">open PR \u2197</a>' : '')
      + '<a href="/dashboard/' + encodeURIComponent(row.dataset.id) + '">full log \u2197</a>'
      + '</div>';
  }

  function renderLines(text) {
    var body = document.getElementById('tail-body');
    if (!body) return;
    if (!text || text.trim() === '') {
      body.innerHTML = '<div class="tail-empty">waiting for logs…</div>';
      return;
    }
    var lines = text.split('\\n').filter(function(l) { return l.trim(); });
    var frag = document.createDocumentFragment();
    lines.forEach(function(l) {
      var kind = 'assistant';
      if (/^\\s*\u2192\\s/.test(l)) kind = 'tool';
      else if (/^\\s*\\[Result:/.test(l) || /^\\s*\\[/.test(l)) kind = 'stdout';
      var row = document.createElement('div');
      row.className = 'ln ' + kind;
      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = l;
      row.appendChild(txt);
      frag.appendChild(row);
    });
    var cursor = document.createElement('div');
    cursor.className = 'ln';
    cursor.innerHTML = '<span class="ts">now</span><span class="cursor">\u258A</span>';
    body.innerHTML = '';
    body.appendChild(frag);
    body.appendChild(cursor);
    body.scrollTop = body.scrollHeight;
  }

  function fetchTail(id) {
    if (!id) return;
    fetch('/api/logs/' + encodeURIComponent(id) + '?tail=40')
      .then(function(res) { if (!res.ok) throw new Error(res.status); return res.text(); })
      .then(renderLines)
      .catch(function() {
        var body = document.getElementById('tail-body');
        if (body) body.innerHTML = '<div class="tail-empty">waiting for logs…</div>';
      });
  }

  function select(id) {
    if (!id) return;
    currentId = id;
    var rows = scroll.querySelectorAll('.active-row');
    rows.forEach(function(r) {
      var active = r.dataset.id === id;
      r.classList.toggle('selected', active);
      if (active) {
        var type = r.dataset.type;
        var color = type === 'create' ? 'var(--accent)'
          : type === 'review' ? 'var(--sky)'
          : type === 'fix-review-comments' ? 'var(--violet)'
          : type === 'code-audit' ? 'var(--green)'
          : type === 'docs-writer' ? 'var(--rose)'
          : 'var(--fg-3)';
        r.style.borderLeftColor = color;
        renderTailShell(r);
        fetchTail(id);
      } else {
        r.style.borderLeftColor = 'transparent';
      }
    });
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollTimer = setInterval(function() {
      if (document.hidden) return;
      fetchTail(currentId);
    }, 3000);
  }

  scroll.addEventListener('click', function(e) {
    var row = e.target.closest('.active-row');
    if (!row) return;
    select(row.dataset.id);
  });

  // Initial selection — if there's an active critter, render header and start polling
  if (currentId) {
    var firstRow = scroll.querySelector('.active-row.selected') || scroll.querySelector('.active-row');
    if (firstRow) renderTailShell(firstRow);
    fetchTail(currentId);
    pollTimer = setInterval(function() {
      if (document.hidden) return;
      fetchTail(currentId);
    }, 3000);
  }
})();

// --- Activity filters / sort / search
(function() {
  var bar = document.getElementById('activity-filterbar');
  var table = document.querySelector('table.activity');
  if (!bar || !table) return;
  var tbody = table.querySelector('tbody');
  var counter = document.getElementById('activity-counter');
  var clearBtn = document.getElementById('clear-filters-btn');
  var search = document.getElementById('activity-search');
  var active = { type: '', status: '' };

  function apply() {
    var rows = tbody.querySelectorAll('tr[data-type]');
    var total = rows.length;
    var visible = 0;
    var q = search ? search.value.toLowerCase() : '';
    rows.forEach(function(r) {
      var matchType = !active.type || r.dataset.type === active.type;
      var matchStatus = !active.status || r.dataset.status === active.status;
      var matchText = !q || r.textContent.toLowerCase().indexOf(q) !== -1;
      var show = matchType && matchStatus && matchText;
      r.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (counter) {
      var hasFilter = active.type || active.status || q;
      counter.textContent = hasFilter ? ('Showing ' + visible + ' of ' + total) : (total + ' entries');
    }
    if (clearBtn) clearBtn.style.display = (active.type || active.status) ? '' : 'none';
  }

  bar.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-filter-group]');
    if (!btn) return;
    var g = btn.dataset.filterGroup;
    var v = btn.dataset.filterValue;
    active[g] = v;
    bar.querySelectorAll('[data-filter-group="' + g + '"]').forEach(function(b) {
      b.classList.toggle('active', b.dataset.filterValue === v);
    });
    apply();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      active.type = '';
      active.status = '';
      if (search) search.value = '';
      bar.querySelectorAll('[data-filter-group]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.filterValue === '');
      });
      apply();
    });
  }

  if (search) {
    search.addEventListener('focus', function() { __paused = true; });
    search.addEventListener('blur', function() { __paused = false; });
    search.addEventListener('input', apply);
  }

  // Sortable columns
  var headers = table.querySelectorAll('th[data-sortable]');
  var current = { col: -1, asc: true };
  headers.forEach(function(th) {
    var colIdx = Array.prototype.indexOf.call(th.parentNode.children, th);
    th.addEventListener('click', function() {
      var asc = current.col === colIdx ? !current.asc : true;
      current = { col: colIdx, asc: asc };
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-type]'));
      var sortType = th.dataset.sortable;
      rows.sort(function(a, b) {
        var ca = a.cells[colIdx];
        var cb = b.cells[colIdx];
        var va, vb;
        if (sortType === 'duration' || sortType === 'cost') {
          va = parseFloat(ca.dataset.sortValue || '-1');
          vb = parseFloat(cb.dataset.sortValue || '-1');
        } else if (sortType === 'date') {
          va = new Date(ca.dataset.sortValue || 0).getTime();
          vb = new Date(cb.dataset.sortValue || 0).getTime();
        } else {
          va = (ca.textContent || '').toLowerCase();
          vb = (cb.textContent || '').toLowerCase();
        }
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
    });
  });

  apply();
})();

// --- Poll now button
(function() {
  var btn = document.getElementById('poll-btn');
  if (!btn) return;
  btn.addEventListener('click', function() {
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = 'Polling…';
    fetch('/poll', { method: 'POST', headers: getAuthHeaders() })
      .then(function(res) { return res.json(); })
      .then(function() {
        btn.textContent = 'Triggered';
        setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 1500);
      })
      .catch(function() {
        btn.textContent = 'Failed';
        setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 1500);
      });
  });
})();

// --- Auto refresh (30s)
(function() {
  if (window._refreshInterval) clearInterval(window._refreshInterval);
  var INTERVAL = 30;
  var remaining = INTERVAL;
  var el = document.getElementById('refresh-countdown');
  function update() { if (el) el.textContent = 'Refreshing in ' + remaining + 's'; }
  function doRefresh() {
    var url = '/dashboard' + window.location.search;
    fetch(url).then(function(r) { return r.text(); }).then(function(html) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');
      var newBody = doc.querySelector('body');
      if (newBody) {
        document.body.innerHTML = newBody.innerHTML;
        document.body.querySelectorAll('script').forEach(function(s) {
          var ns = document.createElement('script');
          ns.textContent = s.textContent;
          s.parentNode.replaceChild(ns, s);
        });
      }
    }).catch(function() { window.location.reload(); });
  }
  window._refreshInterval = setInterval(function() {
    if (__paused) return;
    remaining--;
    if (remaining <= 0) { remaining = INTERVAL; doRefresh(); }
    update();
  }, 1000);
  update();
})();

// --- Create critter modal
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

  if (!modal || !openBtn) return;

  function hide() { modal.classList.remove('open'); __paused = false; }
  function show() {
    modal.classList.add('open'); __paused = true;
    errorEl.style.display = 'none'; successEl.style.display = 'none';
    form.reset(); submitBtn.disabled = false; submitBtn.textContent = 'Create';
    loadMetadata();
  }
  openBtn.addEventListener('click', show);
  cancelBtn.addEventListener('click', hide);
  modal.addEventListener('click', function(e) { if (e.target === modal) hide(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.classList.contains('open')) hide(); });

  function loadMetadata() {
    if (metadataCache) { populate(metadataCache); return; }
    fetch('/api/v1/metadata').then(function(r) { return r.json(); }).then(function(data) {
      metadataCache = data;
      populate(data);
    }).catch(function() {
      errorEl.textContent = 'Failed to load metadata';
      errorEl.style.display = 'block';
    });
  }

  function populate(data) {
    var providers = Object.keys(data.providers || {});
    providerSelect.innerHTML = '';
    providers.forEach(function(p) {
      var o = document.createElement('option');
      o.value = p; o.textContent = p;
      providerSelect.appendChild(o);
    });
    providerWrap.style.display = providers.length > 1 ? '' : 'none';

    typeSelect.innerHTML = '';
    (data.critterTypes || []).forEach(function(ct) {
      var o = document.createElement('option');
      o.value = ct.name; o.textContent = ct.name + ' (' + ct.triggerLabel + ')';
      typeSelect.appendChild(o);
    });

    var repoSelect = document.getElementById('create-repo');
    var repoWrap = document.getElementById('create-repo-wrap');
    var repos = data.repos || [];
    repoSelect.innerHTML = '<option value="">None (specify in description)</option>';
    repos.forEach(function(r) {
      var o = document.createElement('option');
      o.value = r.url; o.textContent = r.label;
      repoSelect.appendChild(o);
    });
    repoWrap.style.display = repos.length > 0 ? '' : 'none';

    updateTeams(data);
  }

  providerSelect.addEventListener('change', function() {
    if (metadataCache) updateTeams(metadataCache);
  });

  function updateTeams(data) {
    var p = providerSelect.value;
    var teams = (data.providers[p] || {}).teams || [];
    teamSelect.innerHTML = '';
    teams.forEach(function(t) {
      var o = document.createElement('option');
      o.value = t.id; o.textContent = t.name + ' (' + t.key + ')';
      teamSelect.appendChild(o);
    });
  }

  function escapeText(s) {
    var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    errorEl.style.display = 'none'; successEl.style.display = 'none';
    submitBtn.disabled = true; submitBtn.textContent = 'Creating…';

    var repo = document.getElementById('create-repo').value;
    var branch = document.getElementById('create-branch').value.trim();
    var description = document.getElementById('create-description').value;
    var prefix = '';
    if (repo && !/^repo:\\s/m.test(description)) prefix += 'repo: ' + repo + '\\n';
    if (branch && !/^branch:\\s/m.test(description)) prefix += 'branch: ' + branch + '\\n';
    if (prefix) description = prefix + '\\n' + description;

    var body = {
      provider: providerSelect.value,
      teamId: teamSelect.value,
      title: document.getElementById('create-title').value,
      description: description,
      critterType: typeSelect.value,
    };

    fetch('/api/v1/issues', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify(body),
    }).then(function(res) {
      if (res.status === 401) {
        localStorage.removeItem('critters-token');
        showAuthPrompt();
        throw new Error('Unauthorized - please set your token');
      }
      return res.json();
    }).then(function(data) {
      if (data.success) {
        var msg = 'Created ' + escapeText(data.identifier);
        if (data.url) {
          var a = document.createElement('a');
          a.href = data.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'View';
          successEl.innerHTML = msg + ' — ';
          successEl.appendChild(a);
        } else {
          successEl.textContent = msg;
        }
        successEl.style.display = 'block';
        fetch('/poll', { method: 'POST', headers: getAuthHeaders() }).catch(function() {});
        setTimeout(hide, 4000);
      } else {
        errorEl.textContent = data.error || 'Unknown error';
        errorEl.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = 'Create';
      }
    }).catch(function(err) {
      errorEl.textContent = err.message || 'Request failed';
      errorEl.style.display = 'block';
      submitBtn.disabled = false; submitBtn.textContent = 'Create';
    });
  });
})();

// --- Notifications
(function() {
  if (!window._notifState) {
    window._notifState = {
      enabled: localStorage.getItem('critters-notif') === 'on',
      lastSeenTimestamp: localStorage.getItem('critters-notif-last-seen') || new Date().toISOString(),
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
    fetch('/metrics').then(function(r) { return r.json(); }).then(function(events) {
      var fresh = events.filter(function(e) { return e.timestamp > state.lastSeenTimestamp; });
      fresh.forEach(function(e) {
        var id = e.identifier || e.issueId || 'Unknown';
        var tag = 'critters-' + id + '-' + e.event;
        var title = '';
        if (e.event === 'task_completed') title = '\u2705 ' + id + (e.prUrl ? ' completed — PR created' : ' completed');
        else if (e.event === 'task_failed') title = '\u274c ' + id + ' failed';
        else if (e.event === 'review_completed' && e.outcome === 'needs_changes') title = '\ud83d\udc40 ' + id + ' needs human review';
        else return;
        var n = new Notification(title, { body: e.critterType ? 'Type: ' + e.critterType : '', tag: tag });
        n.onclick = function() { window.focus(); window.location.href = '/dashboard/' + id; n.close(); };
      });
      if (events.length > 0) {
        var latest = events.reduce(function(m, e) { return e.timestamp > m ? e.timestamp : m; }, state.lastSeenTimestamp);
        state.lastSeenTimestamp = latest;
        localStorage.setItem('critters-notif-last-seen', latest);
      }
    }).catch(function() {});
  }
})();
</script>
</body>
</html>`;
}

function renderTailShell(): string {
  // Placeholder — filled in by client-side JS when a critter is selected.
  // We only render the container; the client populates header/body/footer on load.
  return `            <div class="tail-head"><span class="dim">tail —</span><strong>—</strong></div>
            <div class="tail-body" id="tail-body"><div class="tail-empty">loading…</div></div>
            <div class="tail-foot"><span style="flex:1"></span></div>`;
}
