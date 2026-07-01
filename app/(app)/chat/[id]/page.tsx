import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { ChatClient } from "@/components/chat/chat-client";
import { getGoogleTool } from "@/lib/tools/google-tools";
import { isGoogleConnected } from "@/lib/google/client";
import { listAvailableSkills, defaultActiveSkillIds } from "@/lib/skills";
import { effectivePlugins } from "@/lib/plugins";
import { listPrompts } from "@/lib/prompts";
import { getConversationForUser, listProjects, modelOptions } from "@/lib/data";

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

  const [projects, googleConnected, skills, defaultSkillIds, plugins, savedPrompts] =
    await Promise.all([
      listProjects(user.id),
      isGoogleConnected(user.id),
      listAvailableSkills(user),
      defaultActiveSkillIds(user),
      effectivePlugins(user.id),
      listPrompts(user),
    ]);
  const activeSkillIds = data.conv.skillIds ?? defaultSkillIds;

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
      availableSkills={skills.map((s) => ({
        id: s.id,
        name: s.name,
        scope: s.scope,
      }))}
      initialActiveSkillIds={activeSkillIds}
      initialWebSearch={plugins.web_search === true}
      savedPrompts={savedPrompts.map((p) => ({ id: p.id, title: p.title, body: p.body }))}
    />
  );
}
