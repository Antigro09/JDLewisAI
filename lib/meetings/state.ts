import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingSessions, type MeetingStatus } from "@/lib/db/schema";

/**
 * Meeting lifecycle state machine. Every status write in the codebase goes
 * through `transitionMeeting` (compare-and-swap); nothing else may set
 * `meetingSessions.status`. This is what prevents the resurrection class of
 * bugs (e.g. a straggling transcript final flipping a `complete` meeting back
 * to `active`) and makes double-fired endpoints idempotent.
 */

/** Statuses in which a meeting may receive audio / transcript finals. */
export const LIVE_STATUSES = ["detected", "active", "degraded"] as const satisfies
  readonly MeetingStatus[];

/** Statuses from which closeout may begin (includes retry of failed runs). */
export const END_ELIGIBLE_STATUSES = [
  "detected",
  "active",
  "degraded",
  "failed",
  // Legacy failure value written before the state machine existed.
  "ended",
] as const satisfies readonly MeetingStatus[];

/** The ONLY legal transitions. Everything else is refused by the CAS. */
export const MEETING_TRANSITIONS = {
  detected: ["active", "degraded", "processing", "abandoned"],
  active: ["degraded", "processing", "abandoned"],
  degraded: ["active", "processing", "abandoned"],
  processing: ["complete", "failed"],
  failed: ["processing"],
  ended: ["processing"], // legacy failed — retry only
  complete: [],
  abandoned: [],
} as const satisfies Record<MeetingStatus, readonly MeetingStatus[]>;

/**
 * Compare-and-swap a meeting's status: succeeds (returns true) only if the row
 * is currently in one of `from`. Callers branch on the result instead of
 * assuming the write happened — a false return means someone else transitioned
 * the meeting first, which is normal under concurrency, not an error.
 */
export async function transitionMeeting(
  meetingId: string,
  from: readonly MeetingStatus[],
  to: MeetingStatus,
  extra: Partial<{
    endedAt: Date;
    summary: string | null;
  }> = {},
): Promise<boolean> {
  // Defense in depth: refuse pairs the transition table doesn't allow, so a
  // future call site can't silently introduce an illegal edge.
  const legalFrom = from.filter((f) =>
    (MEETING_TRANSITIONS[f] as readonly MeetingStatus[]).includes(to),
  );
  if (legalFrom.length === 0) return false;

  const updated = await db
    .update(meetingSessions)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(
      and(
        eq(meetingSessions.id, meetingId),
        inArray(meetingSessions.status, legalFrom as MeetingStatus[]),
      ),
    )
    .returning({ id: meetingSessions.id });
  return updated.length > 0;
}

// Janitor thresholds. `updatedAt` advances on every persisted transcript final,
// so a live meeting with speech never looks stale; the in-memory audio check
// below covers long-silent-but-connected sessions.
const STALE_LIVE_MS = 45 * 60 * 1000;
const STALE_PROCESSING_MS = 30 * 60 * 1000;

export type SweepResult = { abandoned: number; failed: number };

/**
 * Janitor: repair stuck states left by crashes, restarts, or killed closeouts.
 * - live meetings (detected/active/degraded) with no DB activity for 45 min and
 *   no recent in-process audio → abandoned (also tears down any local session)
 * - processing meetings older than 30 min → failed (closeout died; retryable)
 *
 * Runs from the CRON_SECRET-gated /api/cron/meetings route and opportunistically
 * (fire-and-forget) on meeting auto-start. Also serves as the meeting-END
 * detector the platform otherwise lacks: a call that ends without the user
 * clicking End eventually stops producing finals and gets closed out here.
 */
export async function sweepStaleMeetings(): Promise<SweepResult> {
  // Imported lazily to avoid a module cycle (live.ts imports state.ts).
  const { hasRecentLiveAudio, stopLiveMeetingTranscription } = await import(
    "@/lib/meetings/live"
  );

  const liveCutoff = new Date(Date.now() - STALE_LIVE_MS);
  const staleLive = await db
    .select({ id: meetingSessions.id, status: meetingSessions.status })
    .from(meetingSessions)
    .where(
      and(
        inArray(meetingSessions.status, LIVE_STATUSES as unknown as MeetingStatus[]),
        lt(meetingSessions.updatedAt, liveCutoff),
      ),
    );

  let abandoned = 0;
  for (const m of staleLive) {
    // A connected session that received audio recently is alive (just silent
    // or between speakers) — leave it alone.
    if (hasRecentLiveAudio(m.id, STALE_LIVE_MS)) continue;
    const ok = await transitionMeeting(m.id, LIVE_STATUSES, "abandoned", {
      endedAt: new Date(),
    });
    if (ok) {
      abandoned += 1;
      try {
        await stopLiveMeetingTranscription(m.id);
      } catch {
        // best-effort socket teardown
      }
    }
  }

  const processingCutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const staleProcessing = await db
    .select({ id: meetingSessions.id })
    .from(meetingSessions)
    .where(
      and(
        eq(meetingSessions.status, "processing"),
        lt(meetingSessions.updatedAt, processingCutoff),
      ),
    );

  let failed = 0;
  for (const m of staleProcessing) {
    if (await transitionMeeting(m.id, ["processing"], "failed")) failed += 1;
  }

  return { abandoned, failed };
}
