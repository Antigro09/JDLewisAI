import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/server";
import {
  exchangeGoogleAuthCode,
  getGoogleAuthProfile,
  verifyGoogleAuthState,
} from "@/lib/auth/google";
import { desktopGateEnabled } from "@/lib/desktop/gate";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function loginRedirect(req: Request, status: string) {
  return NextResponse.redirect(new URL(`/login?google=${status}`, req.url));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return loginRedirect(req, "denied");
  if (!code || !state) return loginRedirect(req, "error");

  const verifiedState = await verifyGoogleAuthState(state);
  if (!verifiedState) return loginRedirect(req, "error");

  try {
    const tokens = await exchangeGoogleAuthCode({ code, origin: url.origin });
    const profile = await getGoogleAuthProfile(tokens.access_token);
    const email = profile.email?.toLowerCase();
    if (!email || profile.verified_email === false) return loginRedirect(req, "error");

    const allowedDomain = process.env.ALLOWED_SIGNUP_DOMAIN?.trim();
    if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
      return loginRedirect(req, "domain");
    }

    let user = (await db.select().from(users).where(eq(users.email, email)))[0];
    if (!user) {
      // Desktop-only production: no self-provisioning, even via Google.
      // (/api/* sits outside the gated middleware matcher, so without this a
      // browser could hand-craft the OAuth flow and mint an account.)
      if (desktopGateEnabled()) return loginRedirect(req, "domain");
      const [created] = await db
        .insert(users)
        .values({
          email,
          name: profile.name?.trim() || email.split("@")[0] || "Google User",
          passwordHash: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
          role: "MEMBER",
        })
        .returning();
      user = created;
    }

    if (user.disabled) return loginRedirect(req, "disabled");
    await setSession(user);
    await recordAudit({
      userId: user.id,
      action: "auth.google",
      detail: "Signed in with Google",
    });
    return NextResponse.redirect(new URL(verifiedState.next, req.url));
  } catch {
    return loginRedirect(req, "error");
  }
}
