export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "\u2014";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function fmtDurationShort(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) return "\u2014";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function fmtCost(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "\u2014";
  return `$${n.toFixed(2)}`;
}

export function fmtAgo(ts: string | number | null): string {
  if (ts == null) return "never";
  try {
    const t = typeof ts === "number" ? ts : new Date(ts).getTime();
    const ms = Date.now() - t;
    const s = Math.floor(ms / 1000);
    if (s < 10) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch {
    return "\u2014";
  }
}

export function fmtAgoShort(ts: string | number | null): string {
  if (ts == null) return "\u2014";
  try {
    const t = typeof ts === "number" ? ts : new Date(ts).getTime();
    const ms = Date.now() - t;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch {
    return "\u2014";
  }
}

export function phaseLabel(phase: string): string {
  if (phase === "plan" || phase === "planning") return "Planning";
  if (phase === "exec" || phase === "execution") return "Execution";
  if (phase === "review") return "Reviewing";
  if (phase === "fix") return "Fixing";
  if (phase === "audit") return "Auditing";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function typeColor(type: string): string {
  switch (type) {
    case "create": return "var(--accent)";
    case "review": return "var(--sky)";
    case "fix-review-comments": return "var(--violet)";
    case "code-audit": return "var(--green)";
    case "docs-writer": return "var(--rose)";
    default: return "var(--fg-3)";
  }
}

export function shortRepo(repo: string): string {
  const parts = repo.split("/");
  return parts[parts.length - 1] ?? repo;
}
