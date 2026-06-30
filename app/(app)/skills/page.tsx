import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { PageShell } from "@/components/page-shell";
import { Badge, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { listAvailableSkills } from "@/lib/skills";
import { createSkill } from "./actions";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const user = await requireUser();
  const skills = await listAvailableSkills(user);
  const isAdmin = user.role === "ADMIN";

  return (
    <PageShell
      title="Skills"
      description="Reusable instruction packs the AI follows — e.g. your RFI format or bid-email style. Active skills apply to every chat; you can toggle them per conversation."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-medium">New skill</h2>
          <form action={createSkill} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="e.g. Company RFI format" required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                placeholder="When this should be used"
              />
            </div>
            <div>
              <Label htmlFor="instructions">Instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={6}
                required
                placeholder="The guidance the AI should follow when this skill is active…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" name="defaultActive" defaultChecked />
              Active by default
            </label>
            {isAdmin && (
              <div>
                <Label htmlFor="scope">Visibility</Label>
                <Select id="scope" name="scope" defaultValue="personal" className="h-10 w-full">
                  <option value="personal">Personal (only me)</option>
                  <option value="org">Org-wide (everyone)</option>
                </Select>
              </div>
            )}
            <SubmitButton>Create skill</SubmitButton>
          </form>
        </Card>

        <div className="space-y-3">
          <h2 className="font-medium">Available skills</h2>
          {skills.length === 0 && (
            <p className="text-sm text-neutral-500">No skills yet.</p>
          )}
          {skills.map((s) => (
            <Link key={s.id} href={`/skills/${s.id}`}>
              <Card className="p-4 transition-colors hover:border-brand-300">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="flex gap-1">
                    {s.scope === "org" && (
                      <Badge className="bg-blue-100 text-blue-700">org</Badge>
                    )}
                    {s.defaultActive && (
                      <Badge className="bg-green-100 text-green-700">active</Badge>
                    )}
                  </div>
                </div>
                {s.description && (
                  <div className="mt-0.5 text-sm text-neutral-500">{s.description}</div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
