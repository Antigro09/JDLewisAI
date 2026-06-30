import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { ConversationsPanel } from "@/components/chat/conversations-panel";
import { ChatClient } from "@/components/chat/chat-client";
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

  const [convs, projects] = await Promise.all([
    listConversations(user.id),
    listProjects(user.id),
  ]);

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
        />
      </div>
    </div>
  );
}
