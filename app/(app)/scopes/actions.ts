"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scopesOfWork } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { generateScopeOfWork } from "@/lib/tools/scope";
import { isTrade } from "@/lib/tools/trades";
import { recordUsage } from "@/lib/usage";

export async function generateScopeAction(formData: FormData) {
  const user = await requireUser();
  const trade = String(formData.get("trade") ?? "");
  if (!isTrade(trade)) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const details = String(formData.get("details") ?? "").trim() || undefined;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  const { sections, usage } = await generateScopeOfWork({
    trade,
    details,
    model,
    effort,
  });
  await recordUsage({
    userId: user.id,
    model: usage.model,
    feature: "scope_of_work",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const inserted = await db
    .insert(scopesOfWork)
    .values({
      userId: user.id,
      projectId,
      trade,
      title: `${trade} — Scope of Work`,
      sections,
    })
    .returning();

  redirect(`/scopes/${inserted[0].id}`);
}

export async function deleteScope(scopeId: string) {
  const user = await requireUser();
  await db
    .delete(scopesOfWork)
    .where(and(eq(scopesOfWork.id, scopeId), eq(scopesOfWork.userId, user.id)));
  redirect("/scopes");
}
