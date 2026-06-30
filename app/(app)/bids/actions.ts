"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bids } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { analyzeBids, type BidVendor } from "@/lib/tools/bid-compare";
import { recordUsage } from "@/lib/usage";

export async function createBidAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const trade = String(formData.get("trade") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  const vendorNames = formData.getAll("vendorName").map(String);
  const vendorAmts = formData.getAll("vendorAmt").map(String);
  const vendorNotes = formData.getAll("vendorNote").map(String);

  const vendors: BidVendor[] = vendorNames
    .map((name, i) => ({
      name: name.trim(),
      totalAmt: vendorAmts[i]?.trim() ?? "",
      notes: vendorNotes[i]?.trim() || undefined,
    }))
    .filter((v) => v.name && v.totalAmt);

  if (vendors.length < 2) return;

  const { analysis, recommendation, usage } = await analyzeBids({
    title,
    trade: trade ?? undefined,
    vendors,
    model,
    effort,
  });
  await recordUsage({
    userId: user.id,
    model: usage.model,
    feature: "bid_compare",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const [inserted] = await db
    .insert(bids)
    .values({ userId: user.id, projectId, title, trade, vendors, analysis, recommendation })
    .returning();

  redirect(`/bids/${inserted.id}`);
}

export async function deleteBidAction(id: string) {
  const user = await requireUser();
  await db.delete(bids).where(and(eq(bids.id, id), eq(bids.userId, user.id)));
  redirect("/bids");
}
