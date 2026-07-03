import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { END_ELIGIBLE_STATUSES, transitionMeeting } from "@/lib/meetings/state";
import { stopLiveMeetingTranscription } from "@/lib/meetings/live";
import { analyzeMeeting, generateMeetingMinutes } from "@/lib/meetings/analysis";
import { indexMeetingMemory } from "@/lib/meetings/memory";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  // Idempotency + single-runner guarantee: only the request that wins this
  // compare-and-swap runs the analysis pipeline. A double-clicked End button,
  // a retry of a failed closeout, and a concurrent /end all resolve safely.
  const claimed = await transitionMeeting(id, END_ELIGIBLE_STATUSES, "processing", {
    endedAt: meeting.endedAt ?? new Date(),
  });
  if (!claimed) {
    if (meeting.status === "complete" || meeting.minutesMarkdown) {
      // Already finished — return the existing minutes instead of re-running.
      return NextResponse.json({ minutes: { minutesMarkdown: meeting.minutesMarkdown, qaNotes: meeting.qaNotes } });
    }
    return NextResponse.json(
      { error: "Meeting closeout is already running." },
      { status: 409 },
    );
  }

  // Close the transcription stream BEFORE analysis so no straggler finals race
  // the pipeline (persistFinal is also status-guarded as a second line of
  // defense). Safe no-op when no live session exists on this process.
  try {
    await stopLiveMeetingTranscription(id);
  } catch {
    // A failed socket teardown must not block closeout.
  }

  try {
    await analyzeMeeting(user, id);
    const minutes = await generateMeetingMinutes(user, id);
    // Index into semantic memory (best-effort — never fail closeout on this).
    try {
      await indexMeetingMemory(id, meeting.companyId);
    } catch {
      // pgvector/embeddings not available; FTS memory still works.
    }
    await recordAudit({
      userId: user.id,
      action: "meeting.end",
      detail: meeting.title,
    });
    return NextResponse.json({ minutes });
  } catch (err) {
    // Closeout failed (model/API error mid-pipeline). Mark failed — retryable
    // by calling /end again; analyzeMeeting replaces derived rows on re-run.
    await transitionMeeting(id, ["processing"], "failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Meeting closeout failed" },
      { status: 400 },
    );
  }
}
