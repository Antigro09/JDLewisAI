import { runAgentTurn, type RunAgentOptions } from "@/lib/claude/agent";
import { createNotification, maybeSendEmailNotification } from "@/lib/notifications";

/** Shared SSE-stream wrapper around `runAgentTurn`: emits the initial `meta`
 * event, drains agent events, and dispatches an approval-needed notification
 * when a turn pauses for confirmation. Used by both the initial-send route
 * and the edit route so they don't duplicate the streaming boilerplate. */
export function streamAgentTurn(opts: {
  agentOptions: RunAgentOptions;
  meta: Record<string, unknown>;
  convTitle: string;
}): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ type: "meta", ...opts.meta });
      try {
        for await (const ev of runAgentTurn(opts.agentOptions)) {
          send(ev);
          if (ev.type === "tool_request") {
            const title = "Action needs your approval";
            const body = `${opts.convTitle}: ${ev.pending
              .map((p) => p.summary)
              .join("; ")}`;
            await createNotification({
              userId: opts.agentOptions.userId,
              kind: "approval_needed",
              title,
              body,
              link: `/chat/${opts.agentOptions.conversationId}`,
            });
            await maybeSendEmailNotification({
              userId: opts.agentOptions.userId,
              title,
              body,
            });
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
}
