import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { bids } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card } from "@/components/ui";
import { deleteBidAction } from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BidDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const bid = (await db.select().from(bids).where(eq(bids.id, id)))[0];
  if (!bid || bid.userId !== user.id) notFound();

  const vendors = Array.isArray(bid.vendors) ? bid.vendors : [];

  return (
    <PageShell
      title={bid.title}
      description={`${vendors.length} vendors compared · ${formatDate(bid.createdAt)}`}
      action={
        <Link href="/bids">
          <Button variant="secondary" size="sm">All Bids</Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <Card className="overflow-x-auto p-5">
          <h3 className="mb-3 font-semibold">Vendor Quotes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                <th className="pb-2 pr-4">Vendor</th>
                <th className="pb-2 pr-4">Total Amount</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v, i) => (
                <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 pr-4 font-medium dark:text-neutral-100">{v.name}</td>
                  <td className="py-2 pr-4 dark:text-neutral-200">${v.totalAmt}</td>
                  <td className="py-2 text-neutral-500 dark:text-neutral-400">{v.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {bid.recommendation && (
          <Card className="border-brand-200 bg-brand-50 p-5">
            <h3 className="mb-2 font-semibold text-brand-900">AI Recommendation</h3>
            <p className="text-sm text-brand-800">{bid.recommendation}</p>
          </Card>
        )}

        {bid.analysis && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Detailed Analysis</h3>
            <pre className="whitespace-pre-wrap text-sm text-neutral-700 leading-relaxed font-sans">
              {bid.analysis}
            </pre>
          </Card>
        )}

        <form action={deleteBidAction.bind(null, bid.id)}>
          <Button type="submit" variant="ghost" size="sm">Delete</Button>
        </form>
      </div>
    </PageShell>
  );
}
