import { requireUser } from "@/lib/auth/server";
import { InvoiceRollupClient } from "./invoice-rollup-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function InvoiceRollupPage() {
  await requireUser();
  return <InvoiceRollupClient />;
}
