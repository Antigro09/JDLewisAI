import { authorizeCronRequest } from "@/lib/auth/cron";
import { NextResponse } from "next/server";
import { sweepStaleMeetings } from "@/lib/meetings/state";
import { purgeExpiredTranscripts } from "@/lib/meetings/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Meeting janitor: repairs stuck lifecycle states (zombie live meetings after
 * restarts/crashed clients → abandoned; dead closeouts → failed/retryable),
 * then purges transcripts past each company's retention window.
 * Point any scheduler at this with `Authorization: Bearer $CRON_SECRET` —
 * same contract as /api/cron/run. Also runs opportunistically from the
 * meeting auto-start route, so a scheduler is a belt-and-suspenders extra.
 * On EC2, set ENABLE_INPROCESS_SCHEDULER=true or hit this from a system
 * cron/systemd timer (see docs/ec2-cron.md).
 */
async function handle(req: Request) {
  const denied = await authorizeCronRequest(req);
  if (denied) return denied;
  const swept = await sweepStaleMeetings();
  const purged = await purgeExpiredTranscripts();
  return NextResponse.json({ ...swept, purged });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
