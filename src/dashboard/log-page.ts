import type { HealthStatus } from "../health.js";
import { resolveAllPhases, resolveWorkDirForIdentifier } from "../log-resolver.js";
import type { PrStatus } from "../pr-status.js";
import { escapeHtml, fmtDuration, renderPrStatusIcons } from "./helpers.js";

export function renderLogPage(identifier: string, status: HealthStatus, workDir: string, prStatuses?: Map<string, PrStatus>): string {
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
      ${activeDetail?.prUrl ? ` &middot; <a href="${escapeHtml(activeDetail.prUrl)}" target="_blank">PR</a>${renderPrStatusIcons(activeDetail.prUrl, prStatuses)}` : ""}
    </div>
  </div>

  ${phases.length > 1 ? `<div class="phase-tabs">
${phases.map((p) => `    <button class="phase-tab${p.phase === (phases[phases.length - 1]?.phase) ? " active" : ""}" data-phase="${escapeHtml(p.phase)}">${escapeHtml(p.phase.charAt(0).toUpperCase() + p.phase.slice(1))}</button>`).join("\n")}
  </div>` : ""}

  <pre id="log-content">Loading...</pre>
  <div id="new-logs-indicator" class="new-logs-indicator">\u2193 New logs</div>

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
