import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  automations,
  automationRuns,
  conversations,
  messages,
  users,
} from "@/lib/db/schema";
import { runAgentTurn } from "@/lib/claude/agent";
import { resolveModel } from "@/lib/claude/models";
import { isGoogleConnected } from "@/lib/google/client";
import { effectivePlugins } from "@/lib/plugins";
import { AUTOMATION_TOOL_NAMES } from "@/lib/tools/google-tools";
import { BASE_SYSTEM, GOOGLE_TOOLS_NOTE } from "@/lib/claude/system";
import { listMemories, buildMemoryPrompt } from "@/lib/memory";
import { truncate } from "@/lib/utils";
import { createNotification, maybeSendEmailNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit";

const AUTOMATION_NOTE = `You are running as an UNATTENDED AUTOMATION on behalf of the user. No human
is available to confirm actions, so complete the task end-to-end using your tools. You may read
Gmail and Drive, create and edit Google Docs & Sheets, and create Gmail DRAFTS — but you CANNOT
send email. Avoid duplicate work: only process items created or received since the last run.
Finish with a single concise sentence summarizing exactly what you did (or that there was nothing
to do).`;

/** Execute one automation: run the agent headlessly and record the result. */
export async function runAutomation(automationId: string): Promise<void> {
  const auto = (
    await db.select().from(automations).where(eq(automations.id, automationId))
  )[0];
  if (!auto) return;

  const owner = (
    await db.select().from(users).where(eq(users.id, auto.ownerId))
  )[0];
  if (!owner || owner.disabled) return;

  const plugins = await effectivePlugins(owner.id);
  const googleEnabled =
    plugins.google !== false && (await isGoogleConnected(owner.id));
  const webSearch = plugins.web_search === true;
  const { model } = resolveModel(
    auto.model ?? "claude-sonnet-4-6",
    auto.effort ?? "medium",
  );
  const effort = auto.effort ?? "medium";

  const conv = (
    await db
      .insert(conversations)
      .values({
        userId: owner.id,
        title: truncate(`Automation: ${auto.name}`, 60),
        model: model.id,
        effort,
        automationId: auto.id,
      })
      .returning()
  )[0];

  const run = (
    await db
      .insert(automationRuns)
      .values({
        automationId: auto.id,
        ownerId: owner.id,
        status: "running",
        conversationId: conv.id,
      })
      .returning()
  )[0];

  const lastRun = auto.lastRunAt
    ? auto.lastRunAt.toISOString()
    : "never (this is the first run)";
  const context = `AUTOMATION TASK:
${auto.instructions}

Run context: current time is ${new Date().toISOString()}; last successful run was ${lastRun}.
Only process items since the last run to avoid duplicates. Complete the task now using your tools.`;

  await db.insert(messages).values({
    conversationId: conv.id,
    role: "user",
    blocks: [{ type: "text", text: context }],
  });

  const memoryPrompt = buildMemoryPrompt(await listMemories(owner));
  const system = [
    BASE_SYSTEM,
    googleEnabled ? GOOGLE_TOOLS_NOTE : "",
    memoryPrompt,
    AUTOMATION_NOTE,
  ]
    .filter(Boolean)
    .join("\n\n");

  let summary = "";
  let errored: string | null = null;
  try {
    for await (const ev of runAgentTurn({
      userId: owner.id,
      conversationId: conv.id,
      model: model.id,
      effort,
      system,
      googleEnabled,
      webSearch,
      autoApprove: true,
      toolNames: AUTOMATION_TOOL_NAMES,
      usageFeature: "automation",
    })) {
      if (ev.type === "text") summary += ev.text;
      else if (ev.type === "error") errored = ev.message;
    }
  } catch (e) {
    errored = e instanceof Error ? e.message : "Automation run failed";
  }

  const finishedAt = new Date();
  await db
    .update(automationRuns)
    .set({
      status: errored ? "error" : "success",
      summary: truncate(summary.trim(), 2000) || null,
      error: errored,
      finishedAt,
    })
    .where(eq(automationRuns.id, run.id));

  await db
    .update(automations)
    .set({
      lastRunAt: finishedAt,
      nextRunAt: new Date(Date.now() + auto.intervalMinutes * 60_000),
      lastError: errored,
    })
    .where(eq(automations.id, auto.id));

  await recordAudit({
    userId: owner.id,
    action: "automation.run",
    detail: `${auto.name} — ${errored ? "error" : "success"}`,
    conversationId: conv.id,
  });

  const title = errored
    ? `Automation failed: ${auto.name}`
    : `Automation completed: ${auto.name}`;
  const body = errored || truncate(summary.trim(), 300) || "No summary.";
  await createNotification({
    userId: owner.id,
    kind: errored ? "error" : "task_complete",
    title,
    body,
    link: "/automations",
  });
  await maybeSendEmailNotification({ userId: owner.id, title, body });
}
