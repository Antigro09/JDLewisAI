"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { changeOrders, type ChangeOrderStatus } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { generateChangeOrderDraft } from "@/lib/tools/change-order";
import { recordUsage } from "@/lib/usage";

export async function createChangeOrderAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!title || !description) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const coNumber = String(formData.get("coNumber") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const costImpact = String(formData.get("costImpact") ?? "").trim() || null;
  const scheduleImpact = String(formData.get("scheduleImpact") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  const { draft, usage } = await generateChangeOrderDraft({
    title,
    description,
    reason: reason ?? undefined,
    costImpact: costImpact ?? undefined,
    scheduleImpact: scheduleImpact ?? undefined,
    coNumber: coNumber ?? undefined,
    model,
    effort,
  });
  await recordUsage({
    userId: user.id,
    model: usage.model,
    feature: "change_order",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const [inserted] = await db
    .insert(changeOrders)
    .values({ userId: user.id, projectId, title, description, reason, costImpact, scheduleImpact, coNumber, generatedDraft: draft })
    .returning();

  redirect(`/changes/${inserted.id}`);
}

export async function updateChangeOrderAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as ChangeOrderStatus;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await db
    .update(changeOrders)
    .set({ status, notes, updatedAt: new Date() })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.userId, user.id)));

  redirect(`/changes/${id}`);
}

export async function deleteChangeOrderAction(id: string) {
  const user = await requireUser();
  await db
    .delete(changeOrders)
    .where(and(eq(changeOrders.id, id), eq(changeOrders.userId, user.id)));
  redirect("/changes");
}
