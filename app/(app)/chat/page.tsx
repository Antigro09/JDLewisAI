import { requireUser } from "@/lib/auth/server";
import { ConversationsPanel } from "@/components/chat/conversations-panel";
import { ChatClient } from "@/components/chat/chat-client";
import {
  listConversations,
  listProjects,
  modelOptions,
  resolveDefaults,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();
  const [convs, projects] = await Promise.all([
    listConversations(user.id),
    listProjects(user.id),
  ]);
  const defaults = resolveDefaults(user.personalization);

  return (
    <div className="flex h-full">
      <ConversationsPanel items={convs} />
      <div className="flex-1">
        <ChatClient
          conversationId={null}
          initialMessages={[]}
          models={modelOptions()}
          initialModel={defaults.model}
          initialEffort={defaults.effort}
          projects={projects}
          initialProjectId={null}
          lockProject={false}
        />
      </div>
    </div>
  );
}
