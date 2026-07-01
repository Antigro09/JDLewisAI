import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { analyzeMeeting } from "@/lib/meetings/analysis";
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
  try {
    const analysis = await analyzeMeeting(user, id);
    await recordAudit({
      userId: user.id,
      action: "meeting.analyze",
      detail: id,
    });
    return NextResponse.json({ analysis });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 400 },
    );
  }
}
