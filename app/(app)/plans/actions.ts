"use server";

import { requireUser } from "@/lib/auth/server";
import { analyzePlan, analyzeDoorFramingTakeoff, type DoorFramingTakeoff } from "@/lib/tools/plan";
import { recordUsage } from "@/lib/usage";

export type PlanState = { markdown?: string; error?: string; fileName?: string };
export type TakeoffPlanState = {
  data?: DoorFramingTakeoff;
  error?: string;
  fileName?: string;
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function analyzePlanAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a plan image or PDF to analyze." };
  }
  if (file.size > MAX_FILE_BYTES) return { error: "File exceeds 15 MB limit." };
  const allowed =
    file.type.startsWith("image/") || file.type === "application/pdf";
  if (!allowed) return { error: "Upload an image or PDF." };

  const question = String(formData.get("question") ?? "").trim() || undefined;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const { markdown, usage } = await analyzePlan({
      fileBase64: base64,
      mime: file.type,
      fileName: file.name,
      question,
      model,
      effort,
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

export async function analyzeDoorFramingAction(
  _prev: TakeoffPlanState,
  formData: FormData,
): Promise<TakeoffPlanState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a plan image or PDF to analyze." };
  }
  if (file.size > MAX_FILE_BYTES) return { error: "File exceeds 15 MB limit." };
  const allowed =
    file.type.startsWith("image/") || file.type === "application/pdf";
  if (!allowed) return { error: "Upload an image or PDF." };

  const wallThicknessIn = Number(formData.get("wallThicknessIn") ?? 4.5);
  const studSpacingIn = Number(formData.get("studSpacingIn") ?? 16);
  const studSize = String(formData.get("studSize") ?? "2x4").trim() || "2x4";

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const { data, usage } = await analyzeDoorFramingTakeoff({
      fileBase64: base64,
      mime: file.type,
      fileName: file.name,
      wallThicknessIn,
      studSpacingIn,
      studSize,
    });
    await recordUsage({
      userId: user.id,
      model: usage.model,
      feature: "plan_takeoff",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return { data, fileName: file.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Analysis failed." };
  }
}
