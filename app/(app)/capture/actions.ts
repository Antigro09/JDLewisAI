"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { analyzePlan } from "@/lib/tools/plan";
import { extractInvoice } from "@/lib/tools/invoice";
import { recordUsage } from "@/lib/usage";

export type CaptureState = { markdown?: string; error?: string; fileName?: string };

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function captureAndAnalyzeAction(
  _prev: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Take or choose a photo first." };
  }
  if (file.size > MAX_FILE_BYTES) return { error: "File exceeds 15 MB limit." };
  const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
  if (!allowed) return { error: "Use a photo or PDF." };

  const kind = String(formData.get("kind") ?? "plan");
  const projectId = String(formData.get("projectId") ?? "") || null;

  if (kind === "invoice") {
    let insertedId: string;
    try {
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
      const [inserted] = await db
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
      insertedId = inserted.id;
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Analysis failed." };
    }
    redirect(`/invoices/${insertedId}`);
  }

  // default: plan reading
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const question = String(formData.get("question") ?? "").trim() || undefined;
    const { markdown, usage } = await analyzePlan({
      fileBase64: base64,
      mime: file.type,
      fileName: file.name,
      question,
    });
    await recordUsage({
      userId: user.id,
      model: usage.model,
      feature: "plan",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return { markdown, fileName: file.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Analysis failed." };
  }
}
