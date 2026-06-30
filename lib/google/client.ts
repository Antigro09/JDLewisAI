import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshAccessToken } from "./oauth";

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google account is not connected.");
    this.name = "GoogleNotConnectedError";
  }
}

export async function getGoogleAccount(userId: string) {
  return (
    await db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, userId))
  )[0];
}

export async function isGoogleConnected(userId: string): Promise<boolean> {
  return Boolean(await getGoogleAccount(userId));
}

/**
 * Returns a valid Google access token for the user, refreshing if it is
 * expired or about to expire. Throws GoogleNotConnectedError if unlinked.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const acct = await getGoogleAccount(userId);
  if (!acct || !acct.accessTokenEnc) throw new GoogleNotConnectedError();

  const expiresAt = acct.expiresAt ? acct.expiresAt.getTime() : 0;
  const stillValid = expiresAt - Date.now() > 60_000;
  if (stillValid) {
    return decryptSecret(acct.accessTokenEnc);
  }

  if (!acct.refreshTokenEnc) {
    // No refresh token; the current access token is our only option.
    return decryptSecret(acct.accessTokenEnc);
  }

  const refreshToken = decryptSecret(acct.refreshTokenEnc);
  const refreshed = await refreshAccessToken(refreshToken);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);

  await db
    .update(googleAccounts)
    .set({
      accessTokenEnc: encryptSecret(refreshed.access_token),
      expiresAt: newExpiry,
      ...(refreshed.scope ? { scope: refreshed.scope } : {}),
    })
    .where(eq(googleAccounts.id, acct.id));

  return refreshed.access_token;
}
