import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { enrollSpeaker } from "@/lib/meetings/speakers";
import { embedVoice, voiceprintConfigured } from "@/lib/meetings/voiceprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Enroll a person's voiceprint once (spec §4). Accepts a short audio sample and
 * an X-Speaker-Name header (or ?name=), computes an embedding via the configured
 * voiceprint service, and stores it as a company speaker profile. Falls back to
 * a name-only profile if the voiceprint service isn't configured.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const displayName = (
    req.headers.get("x-speaker-name") ??
    url.searchParams.get("name") ??
    ""
  ).trim();
  if (!displayName) {
    return NextResponse.json({ error: "A speaker name is required." }, { status: 400 });
  }

  const company = await ensureCompanyForUser(user);
  const audio = Buffer.from(await req.arrayBuffer());

  let embedding: number[] | null = null;
  if (voiceprintConfigured() && audio.length > 0) {
    try {
      embedding = await embedVoice(
        audio,
        req.headers.get("content-type") ?? "audio/webm",
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Voiceprint failed" },
        { status: 502 },
      );
    }
  }

  const profile = await enrollSpeaker({
    companyId: company.id,
    displayName,
    userId: user.id,
    embedding,
  });

  return NextResponse.json({
    ok: true,
    profileId: profile.id,
    displayName: profile.displayName,
    enrolledVoiceprint: Boolean(embedding),
  });
}
