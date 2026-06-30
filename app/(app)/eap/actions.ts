"use server";

import { requireUser } from "@/lib/auth/server";
import { generateEAP } from "@/lib/tools/eap";
import { recordUsage } from "@/lib/usage";

export type EapState = { markdown?: string; error?: string; projectName?: string };

export async function generateEapAction(
  _prev: EapState,
  formData: FormData,
): Promise<EapState> {
  const user = await requireUser();
  const projectName = String(formData.get("projectName") ?? "").trim();
  if (!projectName) return { error: "Enter a project name." };
  const address = String(formData.get("address") ?? "").trim() || undefined;
  const details = String(formData.get("details") ?? "").trim() || undefined;
  const model = String(formData.get("model") ?? "") || undefined;
  const effort = String(formData.get("effort") ?? "") || undefined;

  try {
    const { markdown, usage } = await generateEAP({
      projectName,
      address,
      details,
      model,
      effort,
    });
    await recordUsage({
      userId: user.id,
      model: usage.model,
      feature: "eap",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return { markdown, projectName };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Generation failed." };
  }
}
