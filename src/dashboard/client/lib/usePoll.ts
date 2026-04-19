import { useEffect, useRef, useState } from "react";

export interface PollResult<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Polls `fetcher` every `intervalMs`, pauses when the tab is hidden or when
 * `paused` is true. Aborts in-flight requests on change/unmount.
 */
export function usePoll<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: ReadonlyArray<unknown> = [],
  paused = false,
): PollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is a manual refresh trigger; `deps` is caller-provided.
  useEffect(() => {
    if (paused) return;

    let cancelled = false;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    fetcher(ac.signal)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick, paused, fetcher, ...deps]);

  useEffect(() => {
    if (paused || intervalMs <= 0) return;
    const id = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, paused]);

  return { data, error, loading, refresh: () => setTick((n) => n + 1) };
}
