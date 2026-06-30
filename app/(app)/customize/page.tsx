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
import { SkillUploadForm } from "@/components/customize/skill-upload-form";
import { disconnectGoogle, savePluginPrefs } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "connections", label: "Connections" },
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
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

  const [account, configured, plugins, skills] = await Promise.all([
    getGoogleAccount(user.id),
    Promise.resolve(googleConfigured()),
    effectivePlugins(user.id),
    listAvailableSkills(user),
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
    </PageShell>
  );
}
