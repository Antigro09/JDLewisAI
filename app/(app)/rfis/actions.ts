"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rfis } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { generateRfiDraft } from "@/lib/tools/rfi";
import { recordUsage } from "@/lib/usage";

export async function createRfiAction(formData: FormData) {
  const user = await requireUser();
  const subject = String(formData.get("subject") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();
  if (!subject || !question) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const discipline = String(formData.get("discipline") ?? "").trim() || null;
  const rfiNumber = String(formData.get("rfiNumber") ?? "").trim() || null;
  const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
  const dueDate = String(formData.get("dueDate") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  const { draft, usage } = await generateRfiDraft({
    subject,
    question,
    discipline: discipline ?? undefined,
    rfiNumber: rfiNumber ?? undefined,
    model,
    effort,
  });
  await recordUsage({
    userId: user.id,
    model: usage.model,
    feature: "rfi",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const [inserted] = await db
    .insert(rfis)
    .values({
      userId: user.id,
      projectId,
      subject,
      question,
      discipline,
      rfiNumber,
      assignedTo,
      dueDate,
      generatedDraft: draft,
    })
    .returning();

  redirect(`/rfis/${inserted.id}`);
}

export async function updateRfiAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as "OPEN" | "ANSWERED" | "CLOSED";
  const response = String(formData.get("response") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await db
    .update(rfis)
    .set({ status, response, notes, updatedAt: new Date() })
    .where(and(eq(rfis.id, id), eq(rfis.userId, user.id)));

  redirect(`/rfis/${id}`);
}

export async function deleteRfiAction(id: string) {
  const user = await requireUser();
  await db.delete(rfis).where(and(eq(rfis.id, id), eq(rfis.userId, user.id)));
  redirect("/rfis");
}
