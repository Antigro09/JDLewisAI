import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { ConversationsPanel } from "@/components/chat/conversations-panel";
import { ChatClient } from "@/components/chat/chat-client";
import { getGoogleTool } from "@/lib/tools/google-tools";
import { isGoogleConnected } from "@/lib/google/client";
import {
  getConversationForUser,
  listConversations,
  listProjects,
  modelOptions,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const data = await getConversationForUser(user.id, id);
  if (!data) notFound();

  const [convs, projects, googleConnected] = await Promise.all([
    listConversations(user.id),
    listProjects(user.id),
    isGoogleConnected(user.id),
  ]);

  const initialPending = (data.conv.pendingToolUses ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    summary:
      getGoogleTool(p.name)?.describe(
        (p.input ?? {}) as Record<string, unknown>,
      ) ?? p.name,
  }));

  return (
    <div className="flex h-full">
      <ConversationsPanel items={convs} />
      <div className="flex-1">
        <ChatClient
          conversationId={data.conv.id}
          initialMessages={data.messages}
          models={modelOptions()}
          initialModel={data.conv.model}
          initialEffort={data.conv.effort}
          projects={projects}
          initialProjectId={data.conv.projectId}
          lockProject={true}
          initialPending={initialPending}
          googleConnected={googleConnected}
        />
      </div>
    </div>
  );
}
