import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createOAuthState, getAuthUrl, googleConfigured } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/customize?tab=connections&google=unconfigured", req.url),
    );
  }
  const state = await createOAuthState(user.id);
  return NextResponse.redirect(getAuthUrl(state));
}
