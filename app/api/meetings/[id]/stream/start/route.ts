import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { LIVE_STATUSES } from "@/lib/meetings/state";
import {
  liveMeetingStatus,
  startLiveMeetingTranscription,
} from "@/lib/meetings/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  // Never open a transcription stream for a meeting that has moved past its
  // live phase — audio for a complete/processing meeting has nowhere to go.
  if (!(LIVE_STATUSES as readonly string[]).includes(meeting.status)) {
    return NextResponse.json(
      { error: `Meeting is ${meeting.status}; recording can no longer start.` },
      { status: 409 },
    );
  }
  // Company consent policy: when explicit recording consent is required, no
  // capture may start until this session recorded an acknowledgement
  // (POST /api/meetings/[id]/consent — the live workspace collects it).
  const [company] = await db
    .select({ recordingConsentRequired: companies.recordingConsentRequired })
    .from(companies)
    .where(eq(companies.id, meeting.companyId))
    .limit(1);
  if (company?.recordingConsentRequired && !meeting.consentConfirmed) {
    return NextResponse.json(
      { error: "Recording consent has not been acknowledged for this meeting." },
      { status: 403 },
    );
  }

  let body: { provider?: string; sampleRate?: number; channels?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    await startLiveMeetingTranscription({
      meetingId: id,
      provider: body.provider,
      sampleRate: body.sampleRate,
      channels: body.channels,
    });
    return NextResponse.json({ status: liveMeetingStatus(id) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start live transcription" },
      { status: 400 },
    );
  }
}
