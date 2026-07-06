import { db } from "@/lib/db";
import { usageEvents } from "@/lib/db/schema";
import { estimateCostCents } from "@/lib/claude/models";

/** Anthropic web_search server tool: $10 per 1,000 searches → 1¢ each. */
const WEB_SEARCH_CENTS_PER_REQUEST = 1;

export async function recordUsage(opts: {
  userId: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** Count of web_search server-tool invocations this turn. */
  webSearchRequests?: number;
}): Promise<void> {
  try {
    const costCents =
      estimateCostCents(opts.model, {
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        cacheCreationInputTokens: opts.cacheCreationInputTokens,
        cacheReadInputTokens: opts.cacheReadInputTokens,
      }) +
      (opts.webSearchRequests ?? 0) * WEB_SEARCH_CENTS_PER_REQUEST;
    await db.insert(usageEvents).values({
      userId: opts.userId,
      model: opts.model,
      feature: opts.feature,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      cacheCreationInputTokens: opts.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: opts.cacheReadInputTokens ?? 0,
      costCents,
    });
  } catch (err) {
    // Never let metering failure break a user-facing request — but do log it.
    console.error("recordUsage failed:", err);
  }
}
