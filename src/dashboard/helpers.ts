import type { MetricEvent } from "../metrics.js";
import type { PrStatus } from "../pr-status.js";
import { formatDuration } from "../utils.js";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fmtDuration(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "\u2014";
  return formatDuration(ms);
}

export function formatCost(cost: number | undefined): string {
  if (cost == null || Number.isNaN(cost)) return "\u2014";
  return `$${cost.toFixed(2)}`;
}

export function formatDate(ts: string): string {
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

export function getDateKey(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "unknown";
  }
}

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${MONTHS[monthIdx] ?? parts[1]} ${day}`;
}

export function chartDateLabel(dateStr: string, prevDateStr: string | null): string {
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

export function formatDurationMinutes(ms: number): string {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  return `${mins}m`;
}

export function formatCostLabel(v: number): string {
  if (Number.isInteger(v)) return `$${v}`;
  return `$${parseFloat(v.toFixed(2))}`;
}

export type DayStat = { date: string; completed: number; failed: number; cost: number; avgDuration: number; perType: Record<string, { completed: number; failed: number }> };

export function computeDailyStats(metrics: MetricEvent[], days: number): DayStat[] {
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

export function niceMax(value: number, isCost: boolean): number {
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

export function inferType(m: MetricEvent): string {
  return m.critterType ?? (m.event.startsWith("review_") ? "review" : "create");
}

export function renderPrStatusIcons(prUrl: string, prStatuses?: Map<string, PrStatus>): string {
  if (!prStatuses) return "";
  const s = prStatuses.get(prUrl);
  if (!s) return "";
  const ciIcon = s.ciStatus === "success" ? "\u2705"
    : s.ciStatus === "failure" ? "\u274C"
    : s.ciStatus === "pending" ? "\u23F3"
    : "";
  const reviewIcon = s.reviewStatus === "approved" ? "\uD83D\uDC4D"
    : s.reviewStatus === "changes_requested" ? "\uD83D\uDD04"
    : s.reviewStatus === "pending" ? "\u23F3"
    : "";
  if (!ciIcon && !reviewIcon) return "";
  return ` <span class="pr-status" title="CI: ${s.ciStatus}, Review: ${s.reviewStatus}">${ciIcon}${reviewIcon}</span>`;
}
