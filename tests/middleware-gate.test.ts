import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// middleware.ts sits outside the app/lib test globs, hence this file lives in
// tests/. lib/env snapshots at import, so every scenario re-imports the
// middleware (and the session helpers minting cookies) with the env it needs.

const SECRET = "a-sufficiently-long-secret";

async function importMiddleware(gateSecret?: string) {
  vi.resetModules();
  if (gateSecret === undefined) delete process.env.DESKTOP_GATE_SECRET;
  else process.env.DESKTOP_GATE_SECRET = gateSecret;
  const { middleware } = await import("@/middleware");
  const { createSessionToken } = await import("@/lib/auth/session");
  return { middleware, createSessionToken };
}

afterEach(() => {
  delete process.env.DESKTOP_GATE_SECRET;
});

function request(
  path: string,
  init: { desktopKey?: string; cookie?: string } = {},
) {
  const headers = new Headers();
  if (init.desktopKey) headers.set("x-desktop-key", init.desktopKey);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

async function sessionCookie(
  createSessionToken: (claims: {
    sub: string;
    email: string;
    name: string;
    role: "SUPERADMIN" | "ADMIN" | "MEMBER";
    tv: number;
  }) => Promise<string>,
  role: "SUPERADMIN" | "ADMIN" | "MEMBER",
) {
  const token = await createSessionToken({
    sub: "user-1",
    email: "u@example.com",
    name: "U",
    role,
    tv: 0,
  });
  return `session=${token}`;
}

describe("middleware desktop gate", () => {
  it("gate off: unauthenticated /chat still redirects to login (dev unchanged)", async () => {
    const { middleware } = await importMiddleware();
    const res = await middleware(request("/chat"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("gate on: browsers without the header get a bare 404 everywhere", async () => {
    const { middleware } = await importMiddleware(SECRET);
    for (const path of ["/", "/login", "/chat", "/admin"]) {
      const res = await middleware(request(path));
      expect(res.status).toBe(404);
    }
  });

  it("gate on: the shell's handshake falls through to normal auth", async () => {
    const { middleware } = await importMiddleware(SECRET);
    const res = await middleware(request("/chat", { desktopKey: SECRET }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("gate on: a wrong key is still a 404", async () => {
    const { middleware } = await importMiddleware(SECRET);
    const res = await middleware(request("/chat", { desktopKey: "wrong" }));
    expect(res.status).toBe(404);
  });

  it("gate off: legal pages are public (no login redirect)", async () => {
    const { middleware } = await importMiddleware();
    for (const path of ["/legal/terms", "/legal/privacy", "/legal/eula"]) {
      const res = await middleware(request(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});

describe("middleware role gates", () => {
  it("redirects non-SUPERADMIN users away from /owner", async () => {
    const { middleware, createSessionToken } = await importMiddleware();
    for (const role of ["ADMIN", "MEMBER"] as const) {
      const res = await middleware(
        request("/owner", { cookie: await sessionCookie(createSessionToken, role) }),
      );
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/chat");
    }
  });

  it("lets a SUPERADMIN through to /owner and /admin", async () => {
    const { middleware, createSessionToken } = await importMiddleware();
    const cookie = await sessionCookie(createSessionToken, "SUPERADMIN");
    for (const path of ["/owner", "/admin"]) {
      const res = await middleware(request(path, { cookie }));
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("still redirects MEMBERs away from /admin", async () => {
    const { middleware, createSessionToken } = await importMiddleware();
    const res = await middleware(
      request("/admin", {
        cookie: await sessionCookie(createSessionToken, "MEMBER"),
      }),
    );
    expect(res.headers.get("location")).toContain("/chat");
  });
});
