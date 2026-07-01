import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { loadMeetingBundle } from "@/lib/meetings/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const bundle = await loadMeetingBundle(user, id);
  if (!bundle) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  return NextResponse.json(bundle);
}
