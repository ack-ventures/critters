import { describe, expect, test } from "bun:test";
import { checkAuth } from "../auth.js";

describe("checkAuth", () => {
  test("returns null when token is undefined (no auth configured)", () => {
    const req = new Request("http://localhost/poll", { method: "POST" });
    expect(checkAuth(req, undefined)).toBeNull();
  });

  test("returns null when Authorization header matches Bearer token", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Authorization: "Bearer my-secret-token" },
    });
    expect(checkAuth(req, "my-secret-token")).toBeNull();
  });

  test("returns null when critters_token cookie matches token", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Cookie: "other=value; critters_token=my-secret-token" },
    });
    expect(checkAuth(req, "my-secret-token")).toBeNull();
  });

  test("returns 401 when Authorization header is missing", () => {
    const req = new Request("http://localhost/poll", { method: "POST" });
    const resp = checkAuth(req, "my-secret-token");
    expect(resp).not.toBeNull();
    expect(resp?.status).toBe(401);
  });

  test("returns 401 when Authorization header has wrong token", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    const resp = checkAuth(req, "my-secret-token");
    expect(resp).not.toBeNull();
    expect(resp?.status).toBe(401);
  });

  test("returns 401 when Authorization header uses non-Bearer scheme", () => {
    const req = new Request("http://localhost/poll", {
      method: "POST",
      headers: { Authorization: "Basic my-secret-token" },
    });
    const resp = checkAuth(req, "my-secret-token");
    expect(resp).not.toBeNull();
    expect(resp?.status).toBe(401);
  });
});
