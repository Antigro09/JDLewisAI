import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { speakerProfiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Permanently destroys a speaker profile including its encrypted voiceprint
 * embedding — the destruction mechanism the Privacy Policy's biometric
 * retention schedule points to (deletion on request / offboarding).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const company = await ensureCompanyForUser(user);

  const profile = (
    await db
      .select()
      .from(speakerProfiles)
      .where(
        and(eq(speakerProfiles.id, id), eq(speakerProfiles.companyId, company.id)),
      )
      .limit(1)
  )[0];
  if (!profile) {
    return NextResponse.json({ error: "Speaker profile not found" }, { status: 404 });
  }

  await db.delete(speakerProfiles).where(eq(speakerProfiles.id, profile.id));
  await recordAudit({
    userId: user.id,
    action: "voiceprint.delete",
    detail: profile.displayName,
  });
  return NextResponse.json({ ok: true });
}
