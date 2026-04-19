import { useEffect, useRef, useState } from "react";

export interface SSEResult {
  lines: string[];
  connected: boolean;
  done: boolean;
}

/**
 * Subscribes to an EventSource endpoint. Resets on `url` change.
 * The server emits `{ "event": "done" }` or `{ "event": "heartbeat" }` JSON-encoded
 * control events; everything else is treated as a raw log line.
 */
export function useSSE(url: string | null, maxLines = 400): SSEResult {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!url) {
      setLines([]);
      setConnected(false);
      setDone(false);
      return;
    }

    setLines([]);
    setDone(false);
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      const data = ev.data;
      if (!data) return;
      // control events are single-line JSON starting with '{'
      if (data.startsWith("{")) {
        try {
          const obj = JSON.parse(data) as { event?: string };
          if (obj.event === "done") {
            setDone(true);
            es.close();
            setConnected(false);
            return;
          }
          if (obj.event === "heartbeat") return;
        } catch {
          // fall through: treat as log content
        }
      }
      setLines((prev) => {
        const next = prev.concat(data);
        return next.length > maxLines ? next.slice(next.length - maxLines) : next;
      });
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [url, maxLines]);

  return { lines, connected, done };
}
