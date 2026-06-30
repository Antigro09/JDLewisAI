import { requireUser } from "@/lib/auth/server";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { updatePersonalization } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const p = user.personalization ?? {};

  return (
    <PageShell
      title="Personalization"
      description="Tailor how ContractorAI responds to you. Applied to every chat."
    >
      <Card className="max-w-2xl p-6">
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
    </PageShell>
  );
}
