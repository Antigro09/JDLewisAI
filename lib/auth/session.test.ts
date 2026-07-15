import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  createSessionToken,
  verifySessionToken,
  type SessionClaims,
} from "./session";

const CLAIMS: SessionClaims = {
  sub: "user-1",
  email: "pm@example.com",
  name: "Pat",
  role: "MEMBER",
  tv: 3,
};

describe("session tokens", () => {
  it("round-trips claims including tokenVersion", async () => {
    const token = await createSessionToken(CLAIMS);
    const claims = await verifySessionToken(token);
    expect(claims).toEqual(CLAIMS);
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = await new SignJWT(CLAIMS as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("w".repeat(32)));
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT(CLAIMS as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await verifySessionToken(expired)).toBeNull();
  });

  it("rejects garbage tokens", async () => {
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });

  it("treats a missing tv claim as version 0 (legacy sessions)", async () => {
    const { tv: _tv, ...legacy } = CLAIMS;
    const token = await new SignJWT(legacy as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    const claims = await verifySessionToken(token);
    expect(claims?.tv).toBe(0);
  });

  it("preserves the SUPERADMIN role", async () => {
    const token = await new SignJWT({ ...CLAIMS, role: "SUPERADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    const claims = await verifySessionToken(token);
    expect(claims?.role).toBe("SUPERADMIN");
  });

  it("normalizes unexpected role values to MEMBER", async () => {
    const token = await new SignJWT({ ...CLAIMS, role: "ROOT" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    const claims = await verifySessionToken(token);
    expect(claims?.role).toBe("MEMBER");
  });
});
