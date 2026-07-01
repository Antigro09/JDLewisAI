import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { scopesOfWork, rfis, changeOrders, dailyReports } from "@/lib/db/schema";
import { BrandedDocument } from "@/components/branded-document";
import { getOrgTemplate } from "@/lib/templates/render";
import { scopeToMarkdown } from "@/lib/tools/scope";
import { loadMeetingBundle } from "@/lib/meetings/access";
import { meetingToMarkdown } from "@/lib/meetings/export";

export const dynamic = "force-dynamic";

const KINDS = ["scope", "rfi", "change-order", "daily-report", "meeting-minutes"] as const;
type Kind = (typeof KINDS)[number];

async function loadDoc(
  kind: Kind,
  id: string,
  userId: string,
): Promise<{ title: string; markdown: string } | null> {
  if (kind === "scope") {
    const row = (await db.select().from(scopesOfWork).where(eq(scopesOfWork.id, id)))[0];
    if (!row || row.userId !== userId) return null;
    return { title: row.title, markdown: scopeToMarkdown(row.title, row.sections) };
  }
  if (kind === "rfi") {
    const row = (await db.select().from(rfis).where(eq(rfis.id, id)))[0];
    if (!row || row.userId !== userId || !row.generatedDraft) return null;
    return { title: row.subject, markdown: row.generatedDraft };
  }
  if (kind === "change-order") {
    const row = (await db.select().from(changeOrders).where(eq(changeOrders.id, id)))[0];
    if (!row || row.userId !== userId || !row.generatedDraft) return null;
    return { title: row.title, markdown: row.generatedDraft };
  }
  if (kind === "daily-report") {
    const row = (await db.select().from(dailyReports).where(eq(dailyReports.id, id)))[0];
    if (!row || row.userId !== userId || !row.generatedReport) return null;
    return { title: `Daily Report - ${row.reportDate}`, markdown: row.generatedReport };
  }
  if (kind === "meeting-minutes") {
    const user = await requireUser();
    const bundle = await loadMeetingBundle(user, id);
    if (!bundle) return null;
    return { title: bundle.meeting.title, markdown: meetingToMarkdown(bundle) };
  }
  return null;
}

export default async function PrintDocumentPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const user = await requireUser();
  if (!KINDS.includes(kind as Kind)) notFound();

  const [doc, template] = await Promise.all([
    loadDoc(kind as Kind, id, user.id),
    getOrgTemplate(),
  ]);
  if (!doc) notFound();

  return <BrandedDocument title={doc.title} markdown={doc.markdown} template={template} />;
}
