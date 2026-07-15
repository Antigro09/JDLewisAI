import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { enrollSpeaker } from "@/lib/meetings/speakers";
import { embedVoice, voiceprintConfigured } from "@/lib/meetings/voiceprint";
import { recordAudit } from "@/lib/audit";
import { VOICEPRINT_CONSENT_NOTICE } from "@/lib/legal/disclaimers";
import { VOICEPRINT_CONSENT_VERSION } from "@/lib/legal/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Enroll a person's voiceprint once (spec §4). Accepts a short audio sample and
 * an X-Speaker-Name header (or ?name=), computes an embedding via the configured
 * voiceprint service, and stores it as a company speaker profile. Falls back to
 * a name-only profile if the voiceprint service isn't configured.
 *
 * Biometric consent (BIPA-grade): creating a voiceprint requires the caller to
 * confirm written notice + consent via `x-voiceprint-consent: true` and
 * `x-voiceprint-consent-version: <current>`. Without them the request is
 * rejected with 403 and the response carries the written notice so any client
 * can render it verbatim. Name-only profiles (no biometric) skip the check.
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
  const wouldCreateBiometric = voiceprintConfigured() && audio.length > 0;

  let consent: { at: Date; textVersion: string; byUserId: string } | null = null;
  if (wouldCreateBiometric) {
    const consented = req.headers.get("x-voiceprint-consent") === "true";
    const consentVersion = req.headers.get("x-voiceprint-consent-version");
    if (!consented || consentVersion !== VOICEPRINT_CONSENT_VERSION) {
      return NextResponse.json(
        {
          error: "Biometric consent is required before voiceprint enrollment.",
          consentNotice: VOICEPRINT_CONSENT_NOTICE,
          consentVersion: VOICEPRINT_CONSENT_VERSION,
        },
        { status: 403 },
      );
    }
    consent = {
      at: new Date(),
      textVersion: VOICEPRINT_CONSENT_VERSION,
      byUserId: user.id,
    };
  }

  let embedding: number[] | null = null;
  if (wouldCreateBiometric) {
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
    consent,
  });

  if (embedding) {
    await recordAudit({
      userId: user.id,
      action: "voiceprint.enroll",
      detail: `${profile.displayName} — consent v${VOICEPRINT_CONSENT_VERSION}`,
    });
  }

  return NextResponse.json({
    ok: true,
    profileId: profile.id,
    displayName: profile.displayName,
    enrolledVoiceprint: Boolean(embedding),
  });
}
