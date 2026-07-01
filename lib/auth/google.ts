import { SignJWT, jwtVerify } from "jose";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const GOOGLE_AUTH_SCOPES = ["openid", "email", "profile"];

export function googleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );
}

function stateSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

function redirectUri(origin: string) {
  return (
    process.env.GOOGLE_AUTH_REDIRECT_URI ||
    `${origin.replace(/\/$/, "")}/api/auth/google/callback`
  );
}

function safeNext(next: string | null | undefined): string {
  const n = next || "/chat";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/chat";
}

export async function createGoogleAuthState(opts: {
  next?: string | null;
}): Promise<string> {
  return new SignJWT({
    nonce: crypto.randomUUID(),
    next: safeNext(opts.next),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());
}

export async function verifyGoogleAuthState(
  token: string,
): Promise<{ next: string } | null> {
  try {
    const { payload } = await jwtVerify(token, stateSecret());
    return { next: safeNext(typeof payload.next === "string" ? payload.next : "/chat") };
  } catch {
    return null;
  }
}

export function getGoogleAuthUrl(opts: {
  origin: string;
  state: string;
}): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(opts.origin),
    response_type: "code",
    scope: GOOGLE_AUTH_SCOPES.join(" "),
    state: opts.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleAuthCode(opts: {
  code: string;
  origin: string;
}): Promise<{ access_token: string; expires_in?: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(opts.origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in?: number };
}

export async function getGoogleAuthProfile(
  accessToken: string,
): Promise<{ email?: string; name?: string; verified_email?: boolean }> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return {};
  return (await res.json()) as {
    email?: string;
    name?: string;
    verified_email?: boolean;
  };
}
