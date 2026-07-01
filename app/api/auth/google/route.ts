import { NextResponse } from "next/server";
import {
  createGoogleAuthState,
  getGoogleAuthUrl,
  googleAuthConfigured,
} from "@/lib/auth/google";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?google=unconfigured", req.url));
  }
  const state = await createGoogleAuthState({
    next: url.searchParams.get("next"),
  });
  return NextResponse.redirect(
    getGoogleAuthUrl({ origin: url.origin, state }),
  );
}
