import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { loadMeetingBundle } from "@/lib/meetings/access";
import { MeetingLiveClient } from "@/components/meetings/meeting-live-client";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const bundle = await loadMeetingBundle(user, id);
  if (!bundle) notFound();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <Link
          href="/meetings"
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ChevronLeft size={16} />
          Meetings
        </Link>
        <MeetingLiveClient initialBundle={JSON.parse(JSON.stringify(bundle))} />
      </div>
    </div>
  );
}
