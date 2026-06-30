import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { bids } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Card, Input, Label, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { listProjects } from "@/lib/data";
import { createBidAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BidsPage() {
  const user = await requireUser();
  const [rows, projects] = await Promise.all([
    db.select().from(bids).where(eq(bids.userId, user.id)).orderBy(desc(bids.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="Bid Comparison"
      description="Compare vendor quotes and get AI analysis and recommendations."
    >
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-medium">New Bid Comparison</h2>
        <form action={createBidAction} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="title">Bid Package / Title *</Label>
              <Input id="title" name="title" required placeholder="e.g. Electrical Bid Package — Maple Street Project" />
            </div>
            <div>
              <Label htmlFor="trade">Trade</Label>
              <Input id="trade" name="trade" placeholder="e.g. Electrical" />
            </div>
          </div>
          <div>
            <Label htmlFor="projectId">Project</Label>
            <Select id="projectId" name="projectId" className="max-w-xs">
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Vendor Quotes (min. 2)</Label>
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-3">
                  <Input name="vendorName" placeholder={`Vendor ${i + 1} name`} required={i < 2} />
                  <Input name="vendorAmt" placeholder="Total amount (e.g. 145,000)" required={i < 2} />
                  <Input name="vendorNote" placeholder="Notes (optional)" />
                </div>
              ))}
            </div>
          </div>
          <SubmitButton pendingText="Analyzing…">Compare Bids</SubmitButton>
        </form>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-neutral-500">No bid comparisons yet.</p>
        )}
        {rows.map((bid) => {
          const vendors = Array.isArray(bid.vendors) ? bid.vendors : [];
          return (
            <Link key={bid.id} href={`/bids/${bid.id}`}>
              <Card className="flex items-center justify-between p-4 transition-colors hover:border-brand-300">
                <div className="min-w-0">
                  <div className="truncate font-medium">{bid.title}</div>
                  <div className="text-xs text-neutral-400">
                    {vendors.length} vendors · {bid.trade ? `${bid.trade} · ` : ""}
                    {formatDate(bid.createdAt)}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}
