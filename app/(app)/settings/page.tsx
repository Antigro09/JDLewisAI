import { requireUser } from "@/lib/auth/server";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { getGoogleAccount } from "@/lib/google/client";
import { googleConfigured } from "@/lib/google/oauth";
import { updatePersonalization, disconnectGoogle } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Google account connected.", ok: true },
  denied: { text: "Google connection was cancelled.", ok: false },
  error: { text: "Could not connect Google. Please try again.", ok: false },
  unconfigured: {
    text: "Google OAuth isn't configured on the server yet.",
    ok: false,
  },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const user = await requireUser();
  const p = user.personalization ?? {};
  const { google } = await searchParams;
  const status = google ? STATUS_MESSAGES[google] : undefined;
  const account = await getGoogleAccount(user.id);
  const configured = googleConfigured();

  return (
    <PageShell
      title="Settings"
      description="Personalize ContractorAI and connect your Google account."
    >
      <div className="space-y-6">
        {/* Google connection */}
        <Card className="max-w-2xl p-6">
          <h2 className="font-semibold text-neutral-900">Google connection</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Connect your Google account so the AI can search, create, and edit
            your Drive files (Docs &amp; Sheets) and read/send Gmail on your
            behalf — right from chat.
          </p>

          {status && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                status.ok
                  ? "bg-green-50 text-green-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {status.text}
            </p>
          )}

          <div className="mt-4">
            {account ? (
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-neutral-800">
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

        {/* Personalization */}
        <Card className="max-w-2xl p-6">
          <h2 className="mb-3 font-semibold text-neutral-900">Personalization</h2>
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

            <Button type="submit">Save preferences</Button>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}
