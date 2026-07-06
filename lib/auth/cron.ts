import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit";

/** Constant-time comparison; hashing first equalizes lengths so
 * timingSafeEqual can run (it requires equal-length buffers). */
function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Authorize a cron request (`Authorization: Bearer $CRON_SECRET`).
 * Returns null when authorized, otherwise the error response to send.
 * Failed attempts are throttled per-IP to blunt secret guessing.
 */
export async function authorizeCronRequest(
  req: Request,
): Promise<NextResponse | null> {
  const secret = env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (secret && token && secretsMatch(token, secret)) return null;

  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("cron-auth", ip, {
    limit: 10,
    windowSeconds: 60 * 60,
  });
  // audit_log.user_id is NOT NULL, so unauthenticated attempts can't go
  // there yet — surface them in the platform logs instead.
  log.warn("cron.auth_failed", { ip, path: new URL(req.url).pathname });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
