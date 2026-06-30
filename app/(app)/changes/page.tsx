import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { changeOrders } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { listProjects } from "@/lib/data";
import { createChangeOrderAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ChangeOrdersPage() {
  const user = await requireUser();
  const [rows, projects] = await Promise.all([
    db.select().from(changeOrders).where(eq(changeOrders.userId, user.id)).orderBy(desc(changeOrders.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="Change Orders"
      description="Draft and track change orders with AI-generated formal language."
    >
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-medium">New Change Order</h2>
        <form action={createChangeOrderAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="coNumber">CO Number</Label>
              <Input id="coNumber" name="coNumber" placeholder="e.g. CO-001" />
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
          </div>
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required placeholder="Brief description of the change" />
          </div>
          <div>
            <Label htmlFor="description">Scope of Change *</Label>
            <Textarea id="description" name="description" required rows={4} placeholder="Describe what work is added, removed, or changed…" />
          </div>
          <div>
            <Label htmlFor="reason">Reason / Justification</Label>
            <Textarea id="reason" name="reason" rows={2} placeholder="Why is this change necessary?" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="costImpact">Cost Impact</Label>
              <Input id="costImpact" name="costImpact" placeholder="e.g. +$12,500" />
            </div>
            <div>
              <Label htmlFor="scheduleImpact">Schedule Impact</Label>
              <Input id="scheduleImpact" name="scheduleImpact" placeholder="e.g. +5 calendar days" />
            </div>
          </div>
          <SubmitButton pendingText="Drafting…">Generate Change Order</SubmitButton>
        </form>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-neutral-500">No change orders yet.</p>
        )}
        {rows.map((co) => (
          <Link key={co.id} href={`/changes/${co.id}`}>
            <Card className="flex items-center justify-between p-4 transition-colors hover:border-brand-300">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {co.coNumber ? `${co.coNumber} — ` : ""}{co.title}
                </div>
                <div className="text-xs text-neutral-400">
                  {co.costImpact ? `${co.costImpact} · ` : ""}
                  {formatDate(co.createdAt)}
                </div>
              </div>
              <StatusBadge status={co.status} />
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
