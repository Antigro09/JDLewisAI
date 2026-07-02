import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { runAgentTurn, applyPendingDecisions } from "@/lib/claude/agent";
import { isGoogleConnected } from "@/lib/google/client";
import { effectivePlugins } from "@/lib/plugins";
import { buildChatSystem } from "@/lib/data";
import { WEB_TOOLS_NOTE } from "@/lib/claude/system";
import { createNotification, maybeSendEmailNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  conversationId?: string;
  decisions?: Record<string, "approve" | "reject">;
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const conversationId = body.conversationId;
  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const conv = (
    await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, user.id),
        ),
      )
  )[0];
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const pending = conv.pendingToolUses ?? [];
  if (pending.length === 0) {
    return NextResponse.json({ error: "Nothing to confirm" }, { status: 400 });
  }

  const decisions = body.decisions ?? {};
  const plugins = await effectivePlugins(user.id);
  const googleEnabled =
    plugins.google !== false && (await isGoogleConnected(user.id));
  const webSearch = plugins.web_search === true;
  let system = await buildChatSystem(
    user,
    { projectId: conv.projectId, skillIds: conv.skillIds },
    googleEnabled,
  );
  if (webSearch) system = `${system}\n\n${WEB_TOOLS_NOTE}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ type: "meta", conversationId });
      try {
        for await (const ev of applyPendingDecisions({
          userId: user.id,
          conversationId,
          pending,
          decisions,
        })) {
          send(ev);
        }
        for await (const ev of runAgentTurn({
          userId: user.id,
          conversationId,
          model: conv.model,
          effort: conv.effort,
          system,
          googleEnabled,
          webSearch,
          signal: req.signal,
        })) {
          send(ev);
          if (ev.type === "tool_request") {
            const title = "Action needs your approval";
            const body = `${conv.title}: ${ev.pending.map((p) => p.summary).join("; ")}`;
            await createNotification({
              userId: user.id,
              kind: "approval_needed",
              title,
              body,
              link: `/chat/${conversationId}`,
            });
            await maybeSendEmailNotification({ userId: user.id, title, body });
          }
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Stream failed",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
