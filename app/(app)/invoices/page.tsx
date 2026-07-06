import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { Receipt } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Card, Label, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { listProjects } from "@/lib/data";
import { uploadInvoiceAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const user = await requireUser();
  const [rows, projects] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, user.id))
      .orderBy(desc(invoices.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="Invoices"
      description="Upload an invoice — the AI extracts the details and recommends an action. Stamp it Approved, Needs Review, or Denied."
    >
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-medium">Upload an invoice</h2>
        <form action={uploadInvoiceAction} className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto sm:grow">
            <Label>Invoice file (image or PDF)</Label>
            <input
              type="file"
              name="file"
              accept="image/*,application/pdf"
              required
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>
          <div className="w-full sm:w-auto">
            <Label htmlFor="projectId">Project</Label>
            <Select id="projectId" name="projectId" className="h-10 w-full sm:w-auto">
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <SubmitButton pendingText="Reading…" className="w-full sm:w-auto">
            Extract & review
          </SubmitButton>
        </form>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-ember-faint">No invoices yet.</p>
        )}
        {rows.map((inv) => {
          const ex = (inv.extracted ?? {}) as {
            vendor?: string;
            total?: string;
            invoiceNumber?: string;
          };
          return (
            <Link key={inv.id} href={`/invoices/${inv.id}`} className="block">
              <Card className="flex items-center justify-between gap-3 px-5 py-4 transition-[transform,background] duration-200 ease-ember-out hover:translate-x-1 hover:bg-ember-subtle">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-ember-subtle text-ember-muted">
                    <Receipt size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-semibold text-ember-text">
                      {ex.vendor || inv.fileName}
                      {ex.invoiceNumber ? ` · #${ex.invoiceNumber}` : ""}
                    </div>
                    <div className="text-xs text-ember-faint">
                      {ex.total ? `${ex.total} · ` : ""}
                      {formatDate(inv.createdAt)}
                    </div>
                  </div>
                </div>
                <span className="shrink-0">
                  <StatusBadge status={inv.status} />
                </span>
              </Card>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}
