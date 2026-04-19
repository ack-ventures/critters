import { useEffect, useState } from "react";

/** Force a re-render every `ms`. Pauses when the tab is hidden. */
export function useTick(ms: number): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setN((n) => n + 1);
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
