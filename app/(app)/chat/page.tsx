import { requireUser } from "@/lib/auth/server";
import { ChatClient } from "@/components/chat/chat-client";
import { isGoogleConnected } from "@/lib/google/client";
import { listAvailableSkills, defaultActiveSkillIds } from "@/lib/skills";
import { effectivePlugins } from "@/lib/plugins";
import { listPrompts } from "@/lib/prompts";
import { listProjects, modelOptions, resolveDefaults } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();
  const [projects, googleConnected, skills, activeSkillIds, plugins, savedPrompts] =
    await Promise.all([
      listProjects(user.id),
      isGoogleConnected(user.id),
      listAvailableSkills(user),
      defaultActiveSkillIds(user),
      effectivePlugins(user.id),
      listPrompts(user),
    ]);
  const defaults = resolveDefaults(user.personalization);

  return (
    <ChatClient
      conversationId={null}
      initialMessages={[]}
      models={modelOptions()}
      initialModel={defaults.model}
      initialEffort={defaults.effort}
      projects={projects}
      initialProjectId={null}
      lockProject={false}
      initialPending={[]}
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
