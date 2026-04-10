import type { HealthStatus } from "../health.js";
import { extractPhaseResult, resolveAllPhases, resolveWorkDirForIdentifier } from "../log-resolver.js";
import { getRecentMetrics } from "../metrics.js";
import type { PrStatus } from "../pr-status.js";
import { escapeHtml, fmtDuration, formatCost, formatDate, renderPrStatusIcons } from "./helpers.js";

function formatTokenCount(n: number | undefined): string {
  if (n == null) return "\u2014";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function renderIssuePage(identifier: string, status: HealthStatus, workDir: string, prStatuses?: Map<string, PrStatus>): string {
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
  const _currentPhaseLabel = activeDetail?.phase === "plan" || activeDetail?.phase === "planning" ? "Planning"
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
      <span><a href="${escapeHtml(prUrl)}" target="_blank" rel="noopener">${escapeHtml(prUrl)}</a>${renderPrStatusIcons(prUrl, prStatuses)}</span>` : ""}
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

  <div class="card">
    <h3>Logs</h3>
    ${phases.length > 1 ? `<div class="phase-tabs">
${phases.map((p) => `      <button class="phase-tab${p.phase === (phases[phases.length - 1]?.phase) ? " active" : ""}" data-phase="${escapeHtml(p.phase)}">${escapeHtml(p.phase.charAt(0).toUpperCase() + p.phase.slice(1))}</button>`).join("\n")}
    </div>` : ""}
    <pre id="log-content">Loading...</pre>
    <div id="new-logs-indicator" class="new-logs-indicator">&darr; New logs</div>
  </div>
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
  } else if (!isActive) {
    // No local phases available (work dir cleaned up) — try loading without phase
    // The API will fall back to fetching from the tracker
    loadPhase(null);
  }
})();
</script>
</body>
</html>`;
}
