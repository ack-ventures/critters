import { useEffect, useState } from "react";
import { getAuthHeaders } from "../lib/api.js";

export function NotificationsButton() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(localStorage.getItem("critters-notif") === "on");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    let cancelled = false;
    const lastSeen = localStorage.getItem("critters-notif-last-seen") ?? new Date().toISOString();

    fetch("/metrics", { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((events: Array<Record<string, unknown>>) => {
        if (cancelled) return;
        const fresh = events.filter((e) => (e.timestamp as string) > lastSeen);
        for (const e of fresh) {
          const id = (e.identifier as string) || (e.issueId as string) || "Unknown";
          const tag = `critters-${id}-${e.event as string}`;
          let title = "";
          if (e.event === "task_completed") title = `\u2705 ${id}${e.prUrl ? " completed \u2014 PR created" : " completed"}`;
          else if (e.event === "task_failed") title = `\u274C ${id} failed`;
          else if (e.event === "review_completed" && e.outcome === "needs_changes") title = `\uD83D\uDC40 ${id} needs human review`;
          else continue;

          const n = new Notification(title, { body: e.critterType ? `Type: ${e.critterType as string}` : "", tag });
          n.onclick = () => {
            window.focus();
            window.location.href = `/dashboard/${id}`;
            n.close();
          };
        }
        if (events.length > 0) {
          const latest = events.reduce(
            (m, e) => ((e.timestamp as string) > m ? (e.timestamp as string) : m),
            lastSeen,
          );
          localStorage.setItem("critters-notif-last-seen", latest);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  function toggle() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          setEnabled(true);
          localStorage.setItem("critters-notif", "on");
          localStorage.setItem("critters-notif-last-seen", new Date().toISOString());
        }
      });
    } else if (Notification.permission === "granted") {
      const next = !enabled;
      setEnabled(next);
      localStorage.setItem("critters-notif", next ? "on" : "off");
      if (next) localStorage.setItem("critters-notif-last-seen", new Date().toISOString());
    }
  }

  return (
    <button
      type="button"
      className="btn icon"
      onClick={toggle}
      title={enabled ? "Notifications enabled (click to disable)" : "Enable browser notifications"}
    >
      {"\uD83D\uDD14"}
      {enabled && <span className="notif-dot" />}
    </button>
  );
}
