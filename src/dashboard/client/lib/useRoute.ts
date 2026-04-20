import { useEffect, useState } from "react";
import { type ParsedRoute, parsePath } from "./routes.js";

export function useRoute(): ParsedRoute {
  const [parsed, setParsed] = useState<ParsedRoute>(() => parsePath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setParsed(parsePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return parsed;
}
