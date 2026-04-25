export function isDashboardApiPath(pathname: string): boolean {
  return pathname === "/metrics" ||
    pathname.startsWith("/api/logs/") ||
    // /api/v1/issues keeps its method-specific auth check in health.ts so GET still returns 405.
    (pathname.startsWith("/api/v1/") && pathname !== "/api/v1/auth-check" && pathname !== "/api/v1/issues");
}
