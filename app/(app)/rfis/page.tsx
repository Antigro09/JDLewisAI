import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { rfis } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { listProjects } from "@/lib/data";
import { createRfiAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RfisPage() {
  const user = await requireUser();
  const [rows, projects] = await Promise.all([
    db.select().from(rfis).where(eq(rfis.userId, user.id)).orderBy(desc(rfis.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="RFIs"
      description="Generate formal Request for Information drafts and track responses."
    >
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-medium">New RFI</h2>
        <form action={createRfiAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rfiNumber">RFI Number</Label>
              <Input id="rfiNumber" name="rfiNumber" placeholder="e.g. RFI-001" />
            </div>
            <div>
              <Label htmlFor="discipline">Discipline</Label>
              <Input id="discipline" name="discipline" placeholder="e.g. Structural, MEP" />
            </div>
          </div>
          <div>
            <Label htmlFor="subject">Subject *</Label>
            <Input id="subject" name="subject" required placeholder="Brief subject line" />
          </div>
          <div>
            <Label htmlFor="question">Question / Issue *</Label>
            <Textarea
              id="question"
              name="question"
              required
              rows={4}
              placeholder="Describe the question, ambiguity, or issue in detail…"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
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
              <Label htmlFor="assignedTo">Assigned To</Label>
              <Input id="assignedTo" name="assignedTo" placeholder="Architect, Engineer…" />
            </div>
            <div>
              <Label htmlFor="dueDate">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </div>
          </div>
          <SubmitButton pendingText="Drafting…">Generate RFI Draft</SubmitButton>
        </form>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-neutral-500">No RFIs yet.</p>
        )}
        {rows.map((rfi) => (
          <Link key={rfi.id} href={`/rfis/${rfi.id}`}>
            <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-brand-300">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {rfi.rfiNumber ? `${rfi.rfiNumber} — ` : ""}{rfi.subject}
                </div>
                <div className="text-xs text-neutral-400">
                  {rfi.discipline ? `${rfi.discipline} · ` : ""}
                  {formatDate(rfi.createdAt)}
                </div>
              </div>
              <StatusBadge status={rfi.status} />
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
