export function checkAuth(req: Request, token: string | undefined): Response | null {
  if (token === undefined) return null;

  const header = req.headers.get("Authorization");
  if (header === `Bearer ${token}`) return null;

  if (readCookie(req, "critters_token") === token) return null;

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}
