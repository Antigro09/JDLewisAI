import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { loadMeetingBundle } from "@/lib/meetings/access";
import { isGoogleConnected } from "@/lib/google/client";
import { listSpeakerProfiles } from "@/lib/meetings/speakers";
import { MeetingLiveClient } from "@/components/meetings/meeting-live-client";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autostart?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { autostart } = await searchParams;
  const bundle = await loadMeetingBundle(user, id);
  if (!bundle) notFound();
  const [googleConnected, profiles, consentPolicyRows] = await Promise.all([
    isGoogleConnected(user.id),
    listSpeakerProfiles(bundle.meeting.companyId),
    db
      .select({
        recordingConsentRequired: companies.recordingConsentRequired,
        recordingConsentText: companies.recordingConsentText,
      })
      .from(companies)
      .where(eq(companies.id, bundle.meeting.companyId))
      .limit(1),
  ]);
  const consentPolicy = consentPolicyRows[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href="/meetings"
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ChevronLeft size={16} />
          Meetings
        </Link>
        <MeetingLiveClient
          initialBundle={JSON.parse(JSON.stringify(bundle))}
          googleConnected={googleConnected}
          speakerProfiles={profiles.map((p) => ({ id: p.id, displayName: p.displayName }))}
          autoStart={autostart === "1"}
          consentRequired={consentPolicy?.recordingConsentRequired ?? false}
          consentText={consentPolicy?.recordingConsentText ?? null}
        />
      </div>
    </div>
  );
}
