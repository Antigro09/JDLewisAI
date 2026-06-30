"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices, type InvoiceStatus } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { extractInvoice } from "@/lib/tools/invoice";
import { recordUsage } from "@/lib/usage";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function uploadInvoiceAction(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  const projectId = String(formData.get("projectId") ?? "") || null;
  if (!(file instanceof File) || file.size === 0) return;
  if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 15 MB limit");

  const allowed =
    file.type.startsWith("image/") || file.type === "application/pdf";
  if (!allowed) throw new Error("Upload an image or PDF invoice");

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const { data, usage } = await extractInvoice({
    fileBase64: base64,
    mime: file.type,
    fileName: file.name,
  });
  await recordUsage({
    userId: user.id,
    model: usage.model,
    feature: "invoice",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const inserted = await db
    .insert(invoices)
    .values({
      userId: user.id,
      projectId,
      fileName: file.name,
      fileMime: file.type,
      fileData: base64,
      extracted: data as unknown as Record<string, unknown>,
      status: "PENDING",
      history: [],
    })
    .returning();

  redirect(`/invoices/${inserted[0].id}`);
}

export async function setInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus,
  formData: FormData,
) {
  const user = await requireUser();
  const inv = (
    await db.select().from(invoices).where(eq(invoices.id, invoiceId))
  )[0];
  if (!inv || inv.userId !== user.id) throw new Error("Not found");

  const note = String(formData.get("note") ?? "").trim() || undefined;
  const history = Array.isArray(inv.history) ? inv.history : [];
  history.push({
    at: new Date().toISOString(),
    by: user.name || user.email,
    status,
    note,
  });

  await db
    .update(invoices)
    .set({
      status,
      notes: note ?? inv.notes,
      reviewerId: user.id,
      history,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  revalidatePath(`/invoices/${invoiceId}`);
}

export async function deleteInvoice(invoiceId: string) {
  const user = await requireUser();
  const inv = (
    await db.select().from(invoices).where(eq(invoices.id, invoiceId))
  )[0];
  if (!inv || inv.userId !== user.id) throw new Error("Not found");
  await db.delete(invoices).where(eq(invoices.id, invoiceId));
  redirect("/invoices");
}
