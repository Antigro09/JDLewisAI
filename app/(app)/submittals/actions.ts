"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { submittals, type SubmittalStatus } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";

export async function createSubmittalAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const specSection = String(formData.get("specSection") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const ballInCourt = String(formData.get("ballInCourt") ?? "").trim() || null;
  const dueDate = String(formData.get("dueDate") ?? "").trim() || null;

  const [inserted] = await db
    .insert(submittals)
    .values({ userId: user.id, projectId, title, specSection, description, ballInCourt, dueDate })
    .returning();

  redirect(`/submittals/${inserted.id}`);
}

export async function updateSubmittalAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as SubmittalStatus;
  const ballInCourt = String(formData.get("ballInCourt") ?? "").trim() || null;
  const dueDate = String(formData.get("dueDate") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;

  await db
    .update(submittals)
    .set({ status, ballInCourt, dueDate, notes, description, updatedAt: new Date() })
    .where(and(eq(submittals.id, id), eq(submittals.userId, user.id)));

  redirect(`/submittals/${id}`);
}

export async function deleteSubmittalAction(id: string) {
  const user = await requireUser();
  await db
    .delete(submittals)
    .where(and(eq(submittals.id, id), eq(submittals.userId, user.id)));
  redirect("/submittals");
}
