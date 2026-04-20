export const ROUTES = {
  dashboard: "dashboard",
  inflight: "inflight",
  queue: "queue",
  history: "history",
  logs: "logs",
  types: "types",
  repos: "repos",
  hooks: "hooks",
  tokens: "tokens",
  costs: "costs",
  models: "models",
  releases: "releases",
} as const;

export type RouteKey = keyof typeof ROUTES;

const KNOWN: Set<string> = new Set<string>([...Object.values(ROUTES), "release-notes"]);

export interface ParsedRoute {
  route: RouteKey;
  identifier: string | null;
}

export function parsePath(pathname: string): ParsedRoute {
  if (pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/") {
    return { route: "dashboard", identifier: null };
  }
  if (!pathname.startsWith("/dashboard/")) {
    return { route: "dashboard", identifier: null };
  }
  const seg = decodeURIComponent(pathname.slice("/dashboard/".length).split("/")[0] ?? "");
  if (seg === "release-notes") return { route: "releases", identifier: null };
  if (KNOWN.has(seg)) return { route: seg as RouteKey, identifier: null };
  return { route: "logs", identifier: seg };
}

export function hrefFor(route: RouteKey): string {
  if (route === "dashboard") return "/dashboard";
  return `/dashboard/${ROUTES[route]}`;
}

export function navigate(route: RouteKey): void {
  const href = hrefFor(route);
  if (window.location.pathname !== href) {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}
