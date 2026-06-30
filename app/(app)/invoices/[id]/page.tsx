import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Label, Textarea } from "@/components/ui";
import { StatusBadge, StatusStamp } from "@/components/status-badge";
import type { InvoiceExtraction } from "@/lib/tools/invoice";
import { setInvoiceStatus, deleteInvoice } from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === "" || value === null) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div className="text-sm text-neutral-800 dark:text-neutral-200">{String(value)}</div>
    </div>
  );
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const inv = (
    await db.select().from(invoices).where(eq(invoices.id, id))
  )[0];
  if (!inv || inv.userId !== user.id) notFound();

  const ex = (inv.extracted ?? {}) as InvoiceExtraction;
  const dataUrl = `data:${inv.fileMime};base64,${inv.fileData}`;
  const isImage = inv.fileMime.startsWith("image/");
  const history = Array.isArray(inv.history) ? inv.history : [];

  return (
    <PageShell
      title={ex.vendor || inv.fileName}
      description={ex.invoiceNumber ? `Invoice #${ex.invoiceNumber}` : inv.fileName}
      action={
        <div className="flex items-center gap-3">
          <StatusBadge status={inv.status} size="lg" />
          <Link href="/invoices">
            <Button variant="secondary" size="sm">
              All invoices
            </Button>
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Document view with stamp */}
        <Card className="relative overflow-hidden p-3">
          <StatusStamp status={inv.status} />
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={inv.fileName}
              className="mx-auto max-h-[600px] w-auto rounded"
            />
          ) : (
            <div>
              <iframe
                src={dataUrl}
                title={inv.fileName}
                className="h-[600px] w-full rounded border border-neutral-200 dark:border-neutral-800"
              />
            </div>
          )}
          <div className="mt-2 text-center">
            <a
              href={dataUrl}
              download={inv.fileName}
              className="text-sm text-brand-600 hover:underline"
            >
              Download original
            </a>
          </div>
        </Card>

        {/* Extracted data + review */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Extracted details</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor" value={ex.vendor} />
              <Field label="Invoice #" value={ex.invoiceNumber} />
              <Field label="Invoice date" value={ex.invoiceDate} />
              <Field label="Due date" value={ex.dueDate} />
              <Field label="PO #" value={ex.poNumber} />
              <Field label="Project" value={ex.project} />
              <Field label="Subtotal" value={ex.subtotal} />
              <Field label="Tax" value={ex.tax} />
              <Field label="Total" value={ex.total} />
            </div>

            {Array.isArray(ex.lineItems) && ex.lineItems.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-neutral-400">
                      <th className="border-b py-1 pr-2 dark:border-neutral-800">Description</th>
                      <th className="border-b py-1 pr-2 dark:border-neutral-800">Qty</th>
                      <th className="border-b py-1 pr-2 dark:border-neutral-800">Unit</th>
                      <th className="border-b py-1 dark:border-neutral-800">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ex.lineItems.map((li, i) => (
                      <tr key={i} className="text-neutral-700 dark:text-neutral-300">
                        <td className="border-b py-1 pr-2 dark:border-neutral-800">{li.description}</td>
                        <td className="border-b py-1 pr-2 dark:border-neutral-800">{li.quantity ?? ""}</td>
                        <td className="border-b py-1 pr-2 dark:border-neutral-800">{li.unitPrice ?? ""}</td>
                        <td className="border-b py-1 dark:border-neutral-800">{li.amount ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {(ex.recommendation || (ex.flags && ex.flags.length > 0)) && (
            <Card className="p-5">
              <h3 className="mb-2 font-semibold">AI recommendation</h3>
              {ex.recommendation && (
                <p className="text-sm">
                  <span className="font-medium">{ex.recommendation}</span>
                  {ex.recommendationReason ? ` — ${ex.recommendationReason}` : ""}
                </p>
              )}
              {ex.flags && ex.flags.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
                  {ex.flags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Review</h3>
            <form className="space-y-3">
              <div>
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea id="note" name="note" rows={2} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  formAction={setInvoiceStatus.bind(null, inv.id, "APPROVED")}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Approve
                </Button>
                <Button
                  type="submit"
                  formAction={setInvoiceStatus.bind(null, inv.id, "NEEDS_REVIEW")}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  Needs Review
                </Button>
                <Button
                  type="submit"
                  formAction={setInvoiceStatus.bind(null, inv.id, "DENIED")}
                  variant="danger"
                >
                  Deny
                </Button>
              </div>
            </form>
          </Card>

          {history.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-2 font-semibold">History</h3>
              <ul className="space-y-1 text-sm text-neutral-600">
                {history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <li key={i}>
                      <span className="font-medium">{h.status}</span> by {h.by} ·{" "}
                      {formatDate(h.at)}
                      {h.note ? ` — ${h.note}` : ""}
                    </li>
                  ))}
              </ul>
            </Card>
          )}

          <form action={deleteInvoice.bind(null, inv.id)}>
            <Button type="submit" variant="ghost" size="sm">
              Delete invoice
            </Button>
          </form>
        </div>
      </div>
    </PageShell>
  );
}
