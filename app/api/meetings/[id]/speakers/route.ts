import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { assignSpeakerLabel, listSpeakerProfiles } from "@/lib/meetings/speakers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List company speaker profiles available for assignment. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  const profiles = await listSpeakerProfiles(meeting.companyId);
  return NextResponse.json({
    profiles: profiles.map((p) => ({ id: p.id, displayName: p.displayName })),
  });
}

/** Assign a diarization label to a real person (manual identification). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: { speakerLabel?: string; displayName?: string; profileId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const speakerLabel = (body.speakerLabel ?? "").trim();
  if (!speakerLabel) {
    return NextResponse.json({ error: "speakerLabel is required" }, { status: 400 });
  }

  try {
    const result = await assignSpeakerLabel({
      user,
      meetingId: id,
      speakerLabel,
      displayName: body.displayName,
      profileId: body.profileId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not assign speaker" },
      { status: 400 },
    );
  }
}
