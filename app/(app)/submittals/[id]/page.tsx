import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { submittals } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { updateSubmittalAction, deleteSubmittalAction } from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SubmittalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const submittal = (await db.select().from(submittals).where(eq(submittals.id, id)))[0];
  if (!submittal || submittal.userId !== user.id) notFound();

  return (
    <PageShell
      title={submittal.title}
      description={submittal.specSection ? `Spec ${submittal.specSection}` : `Created ${formatDate(submittal.createdAt)}`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge status={submittal.status} size="lg" />
          <Link href="/submittals">
            <Button variant="secondary" size="sm">All Submittals</Button>
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Details</h3>
          <dl className="space-y-2 text-sm">
            {submittal.specSection && (
              <div><dt className="text-xs uppercase text-neutral-400">Spec Section</dt><dd>{submittal.specSection}</dd></div>
            )}
            {submittal.description && (
              <div><dt className="text-xs uppercase text-neutral-400">Description</dt><dd className="whitespace-pre-wrap">{submittal.description}</dd></div>
            )}
            {submittal.ballInCourt && (
              <div><dt className="text-xs uppercase text-neutral-400">Ball in Court</dt><dd>{submittal.ballInCourt}</dd></div>
            )}
            {submittal.dueDate && (
              <div><dt className="text-xs uppercase text-neutral-400">Due Date</dt><dd>{submittal.dueDate}</dd></div>
            )}
            {submittal.notes && (
              <div><dt className="text-xs uppercase text-neutral-400">Notes</dt><dd className="whitespace-pre-wrap">{submittal.notes}</dd></div>
            )}
            <div><dt className="text-xs uppercase text-neutral-400">Last Updated</dt><dd>{formatDate(submittal.updatedAt)}</dd></div>
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Update</h3>
          <form action={updateSubmittalAction} className="space-y-3">
            <input type="hidden" name="id" value={submittal.id} />
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={submittal.status}>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="APPROVED_AS_NOTED">Approved as Noted</option>
                <option value="REVISE">Revise & Resubmit</option>
                <option value="REJECTED">Rejected</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={2} defaultValue={submittal.description ?? ""} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ballInCourt">Ball in Court</Label>
                <Input id="ballInCourt" name="ballInCourt" defaultValue={submittal.ballInCourt ?? ""} />
              </div>
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Input id="dueDate" name="dueDate" type="date" defaultValue={submittal.dueDate ?? ""} />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} defaultValue={submittal.notes ?? ""} />
            </div>
            <Button type="submit">Save</Button>
          </form>

          <form action={deleteSubmittalAction.bind(null, submittal.id)} className="mt-4">
            <Button type="submit" variant="ghost" size="sm">Delete</Button>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}
