"use server";

import { requireUser } from "@/lib/auth/server";
import { runLocalTool } from "@/lib/tools/local-tools";

export type CalcState = { summary?: string; data?: Record<string, unknown>; error?: string };

export async function runCalculator(
  _prev: CalcState,
  formData: FormData,
): Promise<CalcState> {
  const user = await requireUser();
  const tool = String(formData.get("tool") ?? "");
  const input: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k === "tool") continue;
    const s = String(v).trim();
    if (s === "") continue;
    const n = Number(s);
    input[k] = Number.isFinite(n) && /^-?\d*\.?\d+$/.test(s) ? n : s;
  }
  const r = await runLocalTool(user.id, tool, input);
  if (r.isError) return { error: r.output };
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(r.output);
  } catch {
    // leave empty
  }
  return { summary: r.summary, data };
}
