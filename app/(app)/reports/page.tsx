import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { dailyReports } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { listProjects } from "@/lib/data";
import { createDailyReportAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DailyReportsPage() {
  const user = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const [rows, projects] = await Promise.all([
    db.select().from(dailyReports).where(eq(dailyReports.userId, user.id)).orderBy(desc(dailyReports.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="Daily Reports"
      description="Generate professional daily site reports from your field notes."
    >
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-medium">New Daily Report</h2>
        <form action={createDailyReportAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="reportDate">Date *</Label>
              <Input id="reportDate" name="reportDate" type="date" required defaultValue={today} />
            </div>
            <div>
              <Label htmlFor="projectId">Project</Label>
              <Select id="projectId" name="projectId">
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="weather">Weather</Label>
              <Input id="weather" name="weather" placeholder="e.g. Sunny, 75°F, light wind" />
            </div>
          </div>
          <div>
            <Label htmlFor="laborNotes">Labor / Crew on Site</Label>
            <Textarea id="laborNotes" name="laborNotes" rows={2} placeholder="List trades and headcount, e.g. 4 electricians, 6 framers…" />
          </div>
          <div>
            <Label htmlFor="workPerformed">Work Performed</Label>
            <Textarea id="workPerformed" name="workPerformed" rows={4} placeholder="Describe what was accomplished today by area or trade…" />
          </div>
          <div>
            <Label htmlFor="issues">Issues / Delays / Safety</Label>
            <Textarea id="issues" name="issues" rows={2} placeholder="Any problems, near misses, or delays?" />
          </div>
          <SubmitButton pendingText="Generating…">Generate Daily Report</SubmitButton>
        </form>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-neutral-500">No daily reports yet.</p>
        )}
        {rows.map((r) => (
          <Link key={r.id} href={`/reports/${r.id}`}>
            <Card className="flex items-center justify-between p-4 transition-colors hover:border-brand-300">
              <div className="min-w-0">
                <div className="truncate font-medium">Daily Report — {r.reportDate}</div>
                <div className="text-xs text-neutral-400">
                  {r.weather ? `${r.weather} · ` : ""}
                  {formatDate(r.createdAt)}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
