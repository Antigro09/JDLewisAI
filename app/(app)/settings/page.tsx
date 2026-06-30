import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { Tabs } from "@/components/tabs";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { updatePersonalization } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "general", label: "General" },
  { id: "account", label: "Account" },
  { id: "privacy", label: "Privacy" },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const p = user.personalization ?? {};
  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam! : "general";

  return (
    <PageShell
      title="Settings"
      description="Manage your account, appearance, and privacy."
    >
      <Tabs tabs={TABS} active={tab} basePath="/settings" />

      {tab === "general" && (
        <div className="space-y-6">
          <Card className="max-w-2xl p-6">
            <h2 className="mb-3 font-semibold text-neutral-900 dark:text-neutral-100">
              Personalization
            </h2>
            <form action={updatePersonalization} className="space-y-4">
              <div>
                <Label htmlFor="displayRole">Your role</Label>
                <Input
                  id="displayRole"
                  name="displayRole"
                  defaultValue={p.displayRole ?? ""}
                  placeholder="e.g. Project Manager, Estimator, Superintendent"
                />
              </div>
              <div>
                <Label htmlFor="about">About you / your work</Label>
                <Textarea
                  id="about"
                  name="about"
                  rows={3}
                  defaultValue={p.about ?? ""}
                  placeholder="Context the AI should keep in mind about you and your projects."
                />
              </div>
              <div>
                <Label htmlFor="tone">Preferred tone</Label>
                <Input
                  id="tone"
                  name="tone"
                  defaultValue={p.tone ?? ""}
                  placeholder="e.g. concise and direct; or detailed and explanatory"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="defaultModel">Default model</Label>
                  <Select
                    id="defaultModel"
                    name="defaultModel"
                    defaultValue={p.defaultModel ?? ""}
                    className="h-10 w-full"
                  >
                    <option value="">App default</option>
                    {MODELS.filter((m) => m.enabled).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="defaultEffort">Default effort</Label>
                  <Select
                    id="defaultEffort"
                    name="defaultEffort"
                    defaultValue={p.defaultEffort ?? ""}
                    className="h-10 w-full"
                  >
                    <option value="">App default (high)</option>
                    {ALL_EFFORTS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="darkMode">Appearance</Label>
                <Select
                  id="darkMode"
                  name="darkMode"
                  defaultValue={p.darkMode ?? "system"}
                  className="h-10 w-full"
                >
                  <option value="system">Match system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </div>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="emailNotifications"
                  defaultChecked={p.emailNotifications === true}
                  className="mt-1"
                />
                <span>
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    Email notifications
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    Email yourself when an automation finishes or needs approval
                    (requires Google connected).
                  </span>
                </span>
              </label>

              <Button type="submit">Save preferences</Button>
            </form>
          </Card>

          <Card className="max-w-2xl p-6">
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
              Connections &amp; capabilities
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Connect Google, toggle plugins, and manage skills under Customize.
            </p>
            <Link href="/customize" className="mt-3 inline-block">
              <Button variant="secondary" size="sm">
                Open Customize
              </Button>
            </Link>
          </Card>
        </div>
      )}

      {tab === "account" && (
        <div className="space-y-6">
          <Card className="max-w-2xl p-6">
            <h2 className="mb-3 font-semibold text-neutral-900 dark:text-neutral-100">
              Profile
            </h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-400">Name</div>
                <div className="text-sm text-neutral-800 dark:text-neutral-200">{user.name}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-400">Email</div>
                <div className="text-sm text-neutral-800 dark:text-neutral-200">{user.email}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-400">Role</div>
                <div className="text-sm text-neutral-800 dark:text-neutral-200">
                  {user.role === "ADMIN" ? "Admin" : "Member"}
                </div>
              </div>
            </div>
          </Card>

          <Card className="max-w-2xl p-6">
            <h2 className="mb-3 font-semibold text-neutral-900 dark:text-neutral-100">
              Change password
            </h2>
            <ChangePasswordForm />
          </Card>
        </div>
      )}

      {tab === "privacy" && (
        <Card className="max-w-2xl p-6">
          <h2 className="mb-3 font-semibold text-neutral-900 dark:text-neutral-100">
            Privacy
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            ContractorAI stores, scoped to your account: your chat messages and
            attachments, files you upload to projects, generated documents
            (scopes of work, RFIs, change orders, daily reports, EAPs), and
            per-message AI usage (model, tokens, cost) for billing oversight.
            Admins can see usage totals but not the content of your
            conversations.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link href="/customize" className="text-brand-600 hover:underline dark:text-brand-400">
                Manage connected data sources (Google) →
              </Link>
            </li>
            {user.role === "ADMIN" && (
              <li>
                <Link href="/admin" className="text-brand-600 hover:underline dark:text-brand-400">
                  View org-wide usage in Admin →
                </Link>
              </li>
            )}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}
