"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automations } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { runAutomation } from "@/lib/automations/run";

const ALLOWED_INTERVALS = [15, 30, 60, 360, 1440];

function parseInterval(v: FormDataEntryValue | null): number {
  const n = Number(v);
  return ALLOWED_INTERVALS.includes(n) ? n : 60;
}

async function ownOrThrow(userId: string, id: string) {
  const a = (
    await db.select().from(automations).where(eq(automations.id, id))
  )[0];
  if (!a || a.ownerId !== userId) throw new Error("Not found");
  return a;
}

export async function createAutomation(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();
  if (!name || !instructions) return;
  const enabled = formData.get("enabled") === "on";
  const intervalMinutes = parseInterval(formData.get("intervalMinutes"));

  const inserted = await db
    .insert(automations)
    .values({
      ownerId: user.id,
      name,
      instructions,
      intervalMinutes,
      model: String(formData.get("model") ?? "") || null,
      effort: String(formData.get("effort") ?? "") || null,
      status: enabled ? "active" : "paused",
      nextRunAt: enabled ? new Date() : null,
    })
    .returning();
  redirect(`/automations/${inserted[0].id}`);
}

export async function updateAutomation(id: string, formData: FormData) {
  const user = await requireUser();
  await ownOrThrow(user.id, id);
  await db
    .update(automations)
    .set({
      name: String(formData.get("name") ?? "").trim() || "Untitled automation",
      instructions: String(formData.get("instructions") ?? "").trim(),
      intervalMinutes: parseInterval(formData.get("intervalMinutes")),
      model: String(formData.get("model") ?? "") || null,
      effort: String(formData.get("effort") ?? "") || null,
    })
    .where(eq(automations.id, id));
  revalidatePath(`/automations/${id}`);
}

export async function setAutomationStatus(
  id: string,
  status: "active" | "paused",
) {
  const user = await requireUser();
  const a = await ownOrThrow(user.id, id);
  await db
    .update(automations)
    .set({
      status,
      nextRunAt:
        status === "active" && !a.nextRunAt ? new Date() : a.nextRunAt,
    })
    .where(eq(automations.id, id));
  revalidatePath(`/automations/${id}`);
}

export async function deleteAutomation(id: string) {
  const user = await requireUser();
  await ownOrThrow(user.id, id);
  await db.delete(automations).where(eq(automations.id, id));
  redirect("/automations");
}

export async function runAutomationNow(id: string) {
  const user = await requireUser();
  await ownOrThrow(user.id, id);
  await runAutomation(id);
  revalidatePath(`/automations/${id}`);
}
