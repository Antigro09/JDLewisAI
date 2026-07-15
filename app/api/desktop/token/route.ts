import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { env } from "@/lib/env";
import { isDesktopRequest } from "@/lib/desktop/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Mints the device token the Electron shell attaches to update checks
 * (x-device-token). Called by the desktop bridge after every sign-in /
 * launch, so the 30-day expiry rolls forward and never needs refresh logic.
 * The update proxy re-checks disabled/tokenVersion on every use, so a
 * disabled user's token dies immediately regardless of expiry.
 */
export async function POST(req: Request) {
  if (!(await isDesktopRequest(req.headers))) {
    return new NextResponse(null, { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const company = await ensureCompanyForUser(user);
  const token = await new SignJWT({
    scope: "desktop-update",
    cid: company.id,
    tv: user.tokenVersion,
  })
    .setSubject(user.id)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(new TextEncoder().encode(env.AUTH_SECRET));
  return NextResponse.json({ token });
}
