export function checkAuth(req: Request, token: string | undefined): Response | null {
  if (token === undefined) return null;

  const header = req.headers.get("Authorization");
  if (header === `Bearer ${token}`) return null;

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
