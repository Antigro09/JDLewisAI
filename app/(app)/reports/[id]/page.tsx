import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { dailyReports } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card } from "@/components/ui";
import { deleteDailyReportAction } from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DailyReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, id)))[0];
  if (!report || report.userId !== user.id) notFound();

  return (
    <PageShell
      title={`Daily Report — ${report.reportDate}`}
      description={`Generated ${formatDate(report.createdAt)}`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {report.generatedReport && (
            <Link href={`/print/daily-report/${report.id}`}>
              <Button variant="secondary" size="sm">View branded</Button>
            </Link>
          )}
          <Link href="/reports">
            <Button variant="secondary" size="sm">All Reports</Button>
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Field Notes</h3>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs uppercase text-neutral-400">Date</dt><dd>{report.reportDate}</dd></div>
            {report.weather && (
              <div><dt className="text-xs uppercase text-neutral-400">Weather</dt><dd>{report.weather}</dd></div>
            )}
            {report.laborNotes && (
              <div><dt className="text-xs uppercase text-neutral-400">Labor / Crew</dt><dd className="whitespace-pre-wrap">{report.laborNotes}</dd></div>
            )}
            {report.workPerformed && (
              <div><dt className="text-xs uppercase text-neutral-400">Work Performed</dt><dd className="whitespace-pre-wrap">{report.workPerformed}</dd></div>
            )}
            {report.issues && (
              <div><dt className="text-xs uppercase text-neutral-400">Issues / Delays</dt><dd className="whitespace-pre-wrap">{report.issues}</dd></div>
            )}
          </dl>
        </Card>

        {report.generatedReport && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Generated Report</h3>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
              {report.generatedReport}
            </pre>
          </Card>
        )}
      </div>

      <form action={deleteDailyReportAction.bind(null, report.id)} className="mt-4">
        <Button type="submit" variant="ghost" size="sm">Delete Report</Button>
      </form>
    </PageShell>
  );
}
