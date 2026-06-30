import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { changeOrders } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Label, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { updateChangeOrderAction, deleteChangeOrderAction } from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ChangeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const co = (await db.select().from(changeOrders).where(eq(changeOrders.id, id)))[0];
  if (!co || co.userId !== user.id) notFound();

  return (
    <PageShell
      title={co.title}
      description={co.coNumber ? `Change Order ${co.coNumber}` : `Created ${formatDate(co.createdAt)}`}
      action={
        <div className="flex items-center gap-3">
          <StatusBadge status={co.status} size="lg" />
          <Link href="/changes">
            <Button variant="secondary" size="sm">All Change Orders</Button>
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Details</h3>
            <dl className="space-y-2 text-sm">
              {co.coNumber && (
                <div><dt className="text-xs uppercase text-neutral-400">CO Number</dt><dd>{co.coNumber}</dd></div>
              )}
              <div><dt className="text-xs uppercase text-neutral-400">Scope of Change</dt><dd className="whitespace-pre-wrap">{co.description}</dd></div>
              {co.reason && (
                <div><dt className="text-xs uppercase text-neutral-400">Reason</dt><dd className="whitespace-pre-wrap">{co.reason}</dd></div>
              )}
              {co.costImpact && (
                <div><dt className="text-xs uppercase text-neutral-400">Cost Impact</dt><dd>{co.costImpact}</dd></div>
              )}
              {co.scheduleImpact && (
                <div><dt className="text-xs uppercase text-neutral-400">Schedule Impact</dt><dd>{co.scheduleImpact}</dd></div>
              )}
              {co.notes && (
                <div><dt className="text-xs uppercase text-neutral-400">Notes</dt><dd className="whitespace-pre-wrap">{co.notes}</dd></div>
              )}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Update Status</h3>
            <form action={updateChangeOrderAction} className="space-y-3">
              <input type="hidden" name="id" value={co.id} />
              <div>
                <Label htmlFor="status">Status</Label>
                <Select id="status" name="status" defaultValue={co.status}>
                  <option value="DRAFT">Draft</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={2} defaultValue={co.notes ?? ""} />
              </div>
              <Button type="submit">Save</Button>
            </form>
          </Card>

          <form action={deleteChangeOrderAction.bind(null, co.id)}>
            <Button type="submit" variant="ghost" size="sm">Delete</Button>
          </form>
        </div>

        {co.generatedDraft && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Generated Draft</h3>
            <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-700 leading-relaxed">
              {co.generatedDraft}
            </pre>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
