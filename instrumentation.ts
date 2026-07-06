/**
 * Next 15 instrumentation hook: runs once per server runtime at boot.
 * Importing lib/env here makes a misconfigured deployment fail at startup
 * with a readable error instead of on the first query/request.
 */
export async function register() {
  await import("./lib/env");
  // Node runtime only (register also fires for the edge runtime): the
  // in-process meeting janitor needs pg + timers. No-op unless
  // ENABLE_INPROCESS_SCHEDULER=true (single-instance EC2 — see docs/ec2-cron.md).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMeetingScheduler } = await import("./lib/meetings/scheduler");
    startMeetingScheduler();
  }
}
