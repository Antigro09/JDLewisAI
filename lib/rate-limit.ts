import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Durable fixed-window rate limiting on the rate_limits table (no Redis
 * needed). The counter is bumped with a single INSERT ... ON CONFLICT DO
 * UPDATE that also resets expired windows, so concurrent requests can't
 * read-then-write past the limit.
 */

export type RateLimitOptions = {
  limit: number;
  windowSeconds: number;
};

export type CheckOptions = {
  /** Read the current window count without incrementing it. Use to gate on a
   * counter that some other call increments (e.g. count only failures). */
  peek?: boolean;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the current window resets (0 when allowed). */
  retryAfterSeconds: number;
};

export async function checkRateLimit(
  scope: string,
  id: string,
  opts: RateLimitOptions,
  check: CheckOptions = {},
): Promise<RateLimitResult> {
  const key = `${scope}:${id}`;
  try {
    // peek: read the live window count without touching it (an expired window
    // reads as 0). Otherwise bump the counter, resetting an expired window.
    const result = check.peek
      ? await db.execute(sql`
          SELECT
            CASE WHEN window_start_at <= now() - make_interval(secs => ${opts.windowSeconds}::double precision)
              THEN 0 ELSE count END AS count,
            ceil(greatest(extract(epoch from
              window_start_at + make_interval(secs => ${opts.windowSeconds}::double precision) - now()
            ), 1))::int AS retry_after_seconds
          FROM rate_limits WHERE key = ${key}
        `)
      : await db.execute(sql`
          INSERT INTO rate_limits AS rl (key, count, window_start_at)
          VALUES (${key}, 1, now())
          ON CONFLICT (key) DO UPDATE SET
            count = CASE
              WHEN rl.window_start_at <= now() - make_interval(secs => ${opts.windowSeconds}::double precision)
              THEN 1 ELSE rl.count + 1 END,
            window_start_at = CASE
              WHEN rl.window_start_at <= now() - make_interval(secs => ${opts.windowSeconds}::double precision)
              THEN now() ELSE rl.window_start_at END
          RETURNING
            rl.count AS count,
            ceil(greatest(extract(epoch from
              rl.window_start_at + make_interval(secs => ${opts.windowSeconds}::double precision) - now()
            ), 1))::int AS retry_after_seconds
        `);
    const row = result.rows[0] as
      | { count: number; retry_after_seconds: number }
      | undefined;
    if (!row || row.count <= opts.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: row.retry_after_seconds };
  } catch {
    // Fail open: the limiter is a brake, not a gate — a rate-limit store
    // hiccup must not take sign-in or TTS down with it.
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Clear a counter (e.g. after a successful login) so prior failures don't
 * count against the now-authenticated user. */
export async function resetRateLimit(scope: string, id: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM rate_limits WHERE key = ${`${scope}:${id}`}`);
  } catch {
    // Best-effort; a stale counter self-heals when its window expires.
  }
}

/** Client IP for server actions / RSC. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return trustedClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
}

/** Client IP for route handlers that already hold the Request. */
export function ipFromRequest(req: Request): string {
  return trustedClientIp(
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for"),
  );
}

/**
 * The connecting client's IP as the platform sees it — NOT the leftmost
 * X-Forwarded-For hop, which is client-supplied and trivially spoofed (a
 * password-spray can rotate it to dodge per-IP limits). Vercel/most proxies
 * set x-real-ip to the true peer; the rightmost XFF entry (appended by the
 * outermost trusted proxy) is the fallback.
 */
function trustedClientIp(
  xRealIp: string | null,
  xForwardedFor: string | null,
): string {
  const real = xRealIp?.trim();
  if (real) return real;
  const hops = xForwardedFor?.split(",").map((s) => s.trim()).filter(Boolean);
  if (hops && hops.length) return hops[hops.length - 1];
  return "unknown";
}
