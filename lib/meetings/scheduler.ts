import { log } from "@/lib/log";

/**
 * In-process meeting janitor for single-instance deployments (the EC2 box).
 * Vercel Cron doesn't exist there, so when `ENABLE_INPROCESS_SCHEDULER=true`
 * this runs sweepStaleMeetings + purgeExpiredTranscripts on an interval inside
 * the long-lived Node process — no HTTP hop, no scheduler infra to stand up.
 *
 * NOTE: this assumes a SINGLE app instance. Multi-instance deployments should
 * leave the flag off and point ONE external scheduler at /api/cron/run and
 * /api/cron/meetings instead (see docs/ec2-cron.md).
 */

const TICK_INTERVAL_MS = 5 * 60 * 1000;

// Lives on globalThis so dev-mode module re-evaluation (HMR re-imports this
// file) can't reset the flag and start a second interval.
const globalScope = globalThis as typeof globalThis & {
  __meetingSchedulerStarted?: boolean;
};

/** One janitor pass. Each job is isolated so a failing tick never throws. */
async function tick(): Promise<void> {
  // Lazy imports keep the instrumentation boot path light and avoid touching
  // the DB when this module is merely imported.
  try {
    const { sweepStaleMeetings } = await import("@/lib/meetings/state");
    const swept = await sweepStaleMeetings();
    if (swept.abandoned > 0 || swept.failed > 0) {
      log.info("meetings.scheduler_swept", { ...swept });
    }
  } catch (err) {
    log.error("meetings.scheduler_sweep_failed", err);
  }
  try {
    const { purgeExpiredTranscripts } = await import("@/lib/meetings/retention");
    await purgeExpiredTranscripts();
  } catch (err) {
    log.error("meetings.scheduler_purge_failed", err);
  }
}

/**
 * Start the interval. Idempotent, and a no-op unless
 * `ENABLE_INPROCESS_SCHEDULER=true` — so tests, CI, and `next build` (which
 * also evaluates instrumentation) never spin up timers or DB connections.
 */
export function startMeetingScheduler(): void {
  if (process.env.ENABLE_INPROCESS_SCHEDULER !== "true") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalScope.__meetingSchedulerStarted) return;
  globalScope.__meetingSchedulerStarted = true;

  const interval = setInterval(() => void tick(), TICK_INTERVAL_MS);
  // Don't keep a shutting-down process alive just for the janitor.
  interval.unref?.();
  log.info("meetings.scheduler_started", { intervalMs: TICK_INTERVAL_MS });
}
