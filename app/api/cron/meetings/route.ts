import { NextResponse } from "next/server";
import { sweepStaleMeetings } from "@/lib/meetings/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Meeting janitor: repairs stuck lifecycle states (zombie live meetings after
 * restarts/crashed clients → abandoned; dead closeouts → failed/retryable).
 * Point any scheduler at this with `Authorization: Bearer $CRON_SECRET` —
 * same contract as /api/cron/run. Also runs opportunistically from the
 * meeting auto-start route, so a scheduler is a belt-and-suspenders extra.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sweepStaleMeetings();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
