import { db } from "@/lib/db";
import { usageEvents } from "@/lib/db/schema";
import { estimateCostCents } from "@/lib/claude/models";

export async function recordUsage(opts: {
  userId: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  try {
    await db.insert(usageEvents).values({
      userId: opts.userId,
      model: opts.model,
      feature: opts.feature,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costCents: estimateCostCents(
        opts.model,
        opts.inputTokens,
        opts.outputTokens,
      ),
    });
  } catch {
    // Never let metering failure break a user-facing request.
  }
}
