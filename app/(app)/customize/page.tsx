import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { PageShell } from "@/components/page-shell";
import { Badge, Button, Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { Tabs } from "@/components/tabs";
import { getGoogleAccount } from "@/lib/google/client";
import { googleConfigured } from "@/lib/google/oauth";
import { PLUGINS, effectivePlugins } from "@/lib/plugins";
import { listAvailableSkills } from "@/lib/skills";
import { listMemories, MEMORY_CATEGORIES } from "@/lib/memory";
import { listPrompts } from "@/lib/prompts";
import { Input, Label, Select, Textarea } from "@/components/ui";
import { SkillUploadForm } from "@/components/customize/skill-upload-form";
import {
  disconnectGoogle,
  savePluginPrefs,
  addMemory,
  removeMemory,
  addPrompt,
  removePrompt,
  installBuiltinSkills,
} from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "connections", label: "Connections" },
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory" },
  { id: "prompts", label: "Prompts" },
];

const STATUS_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Google account connected.", ok: true },
  denied: { text: "Google connection was cancelled.", ok: false },
  error: { text: "Could not connect Google. Please try again.", ok: false },
  unconfigured: {
    text: "Google OAuth isn't configured on the server yet.",
    ok: false,
  },
};

export default async function CustomizePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; google?: string }>;
}) {
  const user = await requireUser();
  const { tab: tabParam, google } = await searchParams;
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam! : "connections";
  const status = google ? STATUS_MESSAGES[google] : undefined;
  const isAdmin = user.role === "ADMIN";

  const [account, configured, plugins, skills, memories, savedPrompts] =
    await Promise.all([
      getGoogleAccount(user.id),
      Promise.resolve(googleConfigured()),
      effectivePlugins(user.id),
      listAvailableSkills(user),
      listMemories(user),
      listPrompts(user),
    ]);

  return (
    <PageShell
      title="Customize"
      description="Connections, capability toggles, and reusable skills."
    >
      <Tabs tabs={TABS} active={tab} basePath="/customize" />

      {tab === "connections" && (
        <Card className="max-w-2xl p-6">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
            Google connection
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Connect your Google account so the AI can search, create, and edit
            your Drive files (Docs &amp; Sheets) and read/send Gmail on your
            behalf — right from chat.
          </p>

          {status && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                status.ok
                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              {status.text}
            </p>
          )}

          <div className="mt-4">
            {account ? (
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <div>
                  <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    Connected{account.googleEmail ? ` — ${account.googleEmail}` : ""}
                  </div>
                  <div className="text-xs text-neutral-400">
                    Drive, Docs, Sheets, and Gmail (read &amp; send)
                  </div>
                </div>
                <form action={disconnectGoogle}>
                  <Button type="submit" variant="secondary" size="sm">
                    Disconnect
                  </Button>
                </form>
              </div>
            ) : configured ? (
              <a href="/api/google/connect">
                <Button>Connect Google</Button>
              </a>
            ) : (
              <p className="text-sm text-neutral-400">
                Ask your admin to set <code>GOOGLE_CLIENT_ID</code>,{" "}
                <code>GOOGLE_CLIENT_SECRET</code>, and{" "}
                <code>GOOGLE_REDIRECT_URI</code> to enable this.
              </p>
            )}
          </div>
        </Card>
      )}

      {tab === "plugins" && (
        <Card className="max-w-2xl p-6">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Plugins</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Turn capabilities on or off for your chats.
          </p>
          <form action={savePluginPrefs} className="mt-4 space-y-3">
            {PLUGINS.map((p) => (
              <label key={p.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name={`plugin_${p.id}`}
                  defaultChecked={plugins[p.id]}
                  className="mt-1"
                />
                <span>
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {p.label}
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    {p.description}
                  </span>
                </span>
              </label>
            ))}
            <SubmitButton size="sm">Save plugins</SubmitButton>
          </form>
        </Card>
      )}

      {tab === "skills" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 font-medium dark:text-neutral-100">Upload a skill</h2>
            <SkillUploadForm isAdmin={isAdmin} />
            <p className="mt-3 text-xs text-neutral-400">
              Prefer typing instructions directly?{" "}
              <Link href="/skills" className="text-brand-600 hover:underline dark:text-brand-400">
                Create one manually →
              </Link>
            </p>
            {isAdmin && (
              <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
                <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Install the built-in construction workflow skills (punch list, meeting
                  minutes, quantity takeoff, safety plan, VE, material order, submittal
                  review, schedule recovery, drawing comparison) org-wide.
                </p>
                <form action={installBuiltinSkills}>
                  <SubmitButton size="sm" variant="secondary">
                    Install built-in skills
                  </SubmitButton>
                </form>
              </div>
            )}
          </Card>

          <div className="space-y-3">
            <h2 className="font-medium dark:text-neutral-100">Available skills</h2>
            {skills.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">No skills yet.</p>
            )}
            {skills.map((s) => (
              <Link key={s.id} href={`/skills/${s.id}`}>
                <Card className="p-4 transition-colors hover:border-brand-300">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium dark:text-neutral-100">{s.name}</div>
                    <div className="flex gap-1">
                      {s.scope === "org" && (
                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          org
                        </Badge>
                      )}
                      {s.defaultActive && (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                          active
                        </Badge>
                      )}
                    </div>
                  </div>
                  {s.description && (
                    <div className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                      {s.description}
                    </div>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {tab === "memory" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-1 font-medium dark:text-neutral-100">Add a memory</h2>
            <p className="mb-3 text-xs text-neutral-400">
              Durable facts the AI recalls in every chat — company standards, preferred subs &amp;
              materials, estimating methods, writing style, lessons learned.
            </p>
            <form action={addMemory} className="space-y-3">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select id="category" name="category" defaultValue="standard" className="h-10 w-full">
                  {MEMORY_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="content">Memory</Label>
                <Textarea
                  id="content"
                  name="content"
                  rows={3}
                  required
                  placeholder="e.g. We standardly exclude fire-stopping from electrical scopes; prefer ABC Electric for schools."
                />
              </div>
              {isAdmin && (
                <div>
                  <Label htmlFor="scope">Visibility</Label>
                  <Select id="scope" name="scope" defaultValue="personal" className="h-10 w-full">
                    <option value="personal">Personal (only me)</option>
                    <option value="org">Org-wide (everyone)</option>
                  </Select>
                </div>
              )}
              <SubmitButton size="sm">Save memory</SubmitButton>
            </form>
          </Card>

          <div className="space-y-3">
            <h2 className="font-medium dark:text-neutral-100">Remembered</h2>
            {memories.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Nothing remembered yet.</p>
            )}
            {memories.map((m) => (
              <Card key={m.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="mb-0.5 flex items-center gap-2">
                    <Badge className="bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {MEMORY_CATEGORIES.find((c) => c.id === m.category)?.label ?? "Other"}
                    </Badge>
                    {m.scope === "org" && (
                      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        org
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-neutral-700 dark:text-neutral-200">{m.content}</p>
                </div>
                {(m.ownerId === user.id || (isAdmin && m.scope === "org")) && (
                  <form action={removeMemory.bind(null, m.id)}>
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "prompts" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-1 font-medium dark:text-neutral-100">Save a prompt</h2>
            <p className="mb-3 text-xs text-neutral-400">
              Reusable prompts &amp; workflows you can drop into any chat from the composer&apos;s
              &quot;+&quot; menu.
            </p>
            <form action={addPrompt} className="space-y-3">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required placeholder="e.g. Review a subcontract" />
              </div>
              <div>
                <Label htmlFor="body">Prompt</Label>
                <Textarea
                  id="body"
                  name="body"
                  rows={5}
                  required
                  placeholder="The prompt text to insert into the message box…"
                />
              </div>
              {isAdmin && (
                <div>
                  <Label htmlFor="scope">Visibility</Label>
                  <Select id="scope" name="scope" defaultValue="personal" className="h-10 w-full">
                    <option value="personal">Personal (only me)</option>
                    <option value="org">Org-wide (everyone)</option>
                  </Select>
                </div>
              )}
              <SubmitButton size="sm">Save prompt</SubmitButton>
            </form>
          </Card>

          <div className="space-y-3">
            <h2 className="font-medium dark:text-neutral-100">Saved prompts</h2>
            {savedPrompts.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">No saved prompts yet.</p>
            )}
            {savedPrompts.map((p) => (
              <Card key={p.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="font-medium dark:text-neutral-100">{p.title}</span>
                    {p.scope === "org" && (
                      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        org
                      </Badge>
                    )}
                  </div>
                  <p className="line-clamp-3 text-sm text-neutral-500 dark:text-neutral-400">
                    {p.body}
                  </p>
                </div>
                {(p.ownerId === user.id || (isAdmin && p.scope === "org")) && (
                  <form action={removePrompt.bind(null, p.id)}>
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
