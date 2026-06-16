import type { HealthStatus } from "../health.js";
import { DASHBOARD_CSS, DASHBOARD_JS } from "./bundle.js";
import { escapeHtml } from "./helpers.js";

/**
 * Renders the HTML shell for the React dashboard. The shell inlines the
 * bundled client JS + CSS so the daemon binary can serve the app as a single
 * response with no separate asset routes. Server-side route state is passed
 * to the client via `window.__CRITTERS__`.
 *
 * `status` and `uptime` are accepted for backwards compatibility with the
 * previous signature; they are not used at render time because the client
 * fetches `/api/v1/dashboard` immediately on mount.
 */
export function renderDashboard(
  _metricsPath: string,
  _status: HealthStatus,
  _uptime: number,
  typeFilter?: string,
  _dashboardToken?: string,
  identifier?: string,
): string {
  // Escape characters that could break out of the inline <script> below. JSON.stringify
  // does NOT escape "</script>", "<", ">", "&", or the JS line separators, so an
  // attacker-controlled `identifier` (the raw URL path segment, reflected here) could
  // otherwise terminate the script tag and inject live HTML — reflected XSS on the
  // unauthenticated /dashboard/<id> route. Escaping to \uXXXX keeps the JSON valid.
  const bootstrap = JSON.stringify({
    typeFilter: typeFilter ?? null,
    identifier: identifier ?? null,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const title = identifier ? `${escapeHtml(identifier)} - Critters`
    : typeFilter ? `Critters \u00b7 ${escapeHtml(typeFilter)}`
    : "Critters Dashboard";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <noscript><meta http-equiv="refresh" content="30;url=${typeFilter ? `/dashboard?type=${encodeURIComponent(typeFilter)}` : `/dashboard`}"></noscript>
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x1F41B;</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Instrument+Serif&display=swap" rel="stylesheet">
  <style>${DASHBOARD_CSS}</style>
</head>
<body>
  <div id="root"><div class="app-loading">Loading dashboard\u2026</div></div>
  <script>window.__CRITTERS__ = ${bootstrap};</script>
  <script type="module">${DASHBOARD_JS}</script>
</body>
</html>`;
}
