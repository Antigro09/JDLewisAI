import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, getUserInfo, verifyOAuthState } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settings = (status: string) =>
    NextResponse.redirect(new URL(`/settings?google=${status}`, req.url));

  if (error) return settings("denied");
  if (!code || !state) return settings("error");

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const stateUserId = await verifyOAuthState(state);
  if (!stateUserId || stateUserId !== user.id) return settings("error");

  try {
    const tokens = await exchangeCode(code);
    const info = await getUserInfo(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const existing = (
      await db
        .select()
        .from(googleAccounts)
        .where(eq(googleAccounts.userId, user.id))
    )[0];

    if (existing) {
      await db
        .update(googleAccounts)
        .set({
          googleEmail: info.email ?? existing.googleEmail,
          accessTokenEnc: encryptSecret(tokens.access_token),
          // Keep the prior refresh token if Google didn't return a new one.
          refreshTokenEnc: tokens.refresh_token
            ? encryptSecret(tokens.refresh_token)
            : existing.refreshTokenEnc,
          scope: tokens.scope ?? existing.scope,
          expiresAt,
        })
        .where(eq(googleAccounts.id, existing.id));
    } else {
      await db.insert(googleAccounts).values({
        userId: user.id,
        googleEmail: info.email ?? null,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: tokens.refresh_token
          ? encryptSecret(tokens.refresh_token)
          : null,
        scope: tokens.scope ?? null,
        expiresAt,
      });
    }

    return settings("connected");
  } catch {
    return settings("error");
  }
}
