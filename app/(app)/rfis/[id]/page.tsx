import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { rfis } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Label, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { updateRfiAction, deleteRfiAction } from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RfiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const rfi = (await db.select().from(rfis).where(eq(rfis.id, id)))[0];
  if (!rfi || rfi.userId !== user.id) notFound();

  return (
    <PageShell
      title={rfi.subject}
      description={rfi.rfiNumber ? `RFI ${rfi.rfiNumber}` : `Created ${formatDate(rfi.createdAt)}`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge status={rfi.status} size="lg" />
          {rfi.generatedDraft && (
            <Link href={`/print/rfi/${rfi.id}`}>
              <Button variant="secondary" size="sm">View branded</Button>
            </Link>
          )}
          <Link href="/rfis">
            <Button variant="secondary" size="sm">All RFIs</Button>
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">RFI Details</h3>
            <dl className="space-y-2 text-sm">
              {rfi.rfiNumber && (
                <div><dt className="text-xs uppercase text-neutral-400">Number</dt><dd>{rfi.rfiNumber}</dd></div>
              )}
              {rfi.discipline && (
                <div><dt className="text-xs uppercase text-neutral-400">Discipline</dt><dd>{rfi.discipline}</dd></div>
              )}
              {rfi.assignedTo && (
                <div><dt className="text-xs uppercase text-neutral-400">Assigned To</dt><dd>{rfi.assignedTo}</dd></div>
              )}
              {rfi.dueDate && (
                <div><dt className="text-xs uppercase text-neutral-400">Due Date</dt><dd>{rfi.dueDate}</dd></div>
              )}
              <div>
                <dt className="text-xs uppercase text-neutral-400">Question / Issue</dt>
                <dd className="whitespace-pre-wrap">{rfi.question}</dd>
              </div>
              {rfi.response && (
                <div>
                  <dt className="text-xs uppercase text-neutral-400">Response Received</dt>
                  <dd className="whitespace-pre-wrap">{rfi.response}</dd>
                </div>
              )}
              {rfi.notes && (
                <div>
                  <dt className="text-xs uppercase text-neutral-400">Notes</dt>
                  <dd className="whitespace-pre-wrap">{rfi.notes}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Update Status</h3>
            <form action={updateRfiAction} className="space-y-3">
              <input type="hidden" name="id" value={rfi.id} />
              <div>
                <Label htmlFor="status">Status</Label>
                <Select id="status" name="status" defaultValue={rfi.status}>
                  <option value="OPEN">Open</option>
                  <option value="ANSWERED">Answered</option>
                  <option value="CLOSED">Closed</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="response">Response from Architect/Engineer</Label>
                <Textarea id="response" name="response" rows={3} defaultValue={rfi.response ?? ""} />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={2} defaultValue={rfi.notes ?? ""} />
              </div>
              <Button type="submit">Save</Button>
            </form>
          </Card>

          <form action={deleteRfiAction.bind(null, rfi.id)}>
            <Button type="submit" variant="ghost" size="sm">Delete RFI</Button>
          </form>
        </div>

        {rfi.generatedDraft && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Generated Draft</h3>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
              {rfi.generatedDraft}
            </pre>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
