import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { stopLiveMeetingTranscription } from "@/lib/meetings/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  await stopLiveMeetingTranscription(id);
  return NextResponse.json({ stopped: true });
}
