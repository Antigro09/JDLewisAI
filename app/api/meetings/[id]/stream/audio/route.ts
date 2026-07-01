import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getMeetingForUser } from "@/lib/meetings/access";
import { sendLiveMeetingAudio } from "@/lib/meetings/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  audioBase64?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meeting = await getMeetingForUser(user, id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";
  let audio: Buffer;
  if (contentType.includes("application/octet-stream")) {
    audio = Buffer.from(await req.arrayBuffer());
  } else {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.audioBase64) {
      return NextResponse.json({ error: "audioBase64 required" }, { status: 400 });
    }
    audio = Buffer.from(body.audioBase64, "base64");
  }

  if (!audio.length) return NextResponse.json({ error: "Audio chunk required" }, { status: 400 });

  try {
    await sendLiveMeetingAudio(id, audio);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not send audio" },
      { status: 400 },
    );
  }
}
