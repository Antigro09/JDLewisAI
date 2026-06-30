import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { updateSkill, deleteSkill } from "../actions";

export const dynamic = "force-dynamic";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const skill = (await db.select().from(skills).where(eq(skills.id, id)))[0];

  const available =
    skill && (skill.ownerId === user.id || skill.scope === "org");
  if (!skill || !available) notFound();

  const canEdit =
    skill.ownerId === user.id ||
    (user.role === "ADMIN" && skill.scope === "org");

  return (
    <PageShell
      title={skill.name}
      description={skill.scope === "org" ? "Org-wide skill" : "Personal skill"}
      action={
        <Link href="/skills">
          <Button variant="secondary" size="sm">
            All skills
          </Button>
        </Link>
      }
    >
      <Card className="max-w-2xl p-6">
        {canEdit ? (
          <form action={updateSkill.bind(null, skill.id)} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={skill.name} required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                defaultValue={skill.description ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="instructions">Instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={8}
                defaultValue={skill.instructions}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                name="defaultActive"
                defaultChecked={skill.defaultActive}
              />
              Active by default
            </label>
            {user.role === "ADMIN" && (
              <div>
                <Label htmlFor="scope">Visibility</Label>
                <Select
                  id="scope"
                  name="scope"
                  defaultValue={skill.scope}
                  className="h-10 w-full"
                >
                  <option value="personal">Personal (only me)</option>
                  <option value="org">Org-wide (everyone)</option>
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <SubmitButton>Save</SubmitButton>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <Badge className="bg-blue-100 text-blue-700">org skill</Badge>
            {skill.description && (
              <p className="text-sm text-neutral-500">{skill.description}</p>
            )}
            <pre className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
              {skill.instructions}
            </pre>
            <p className="text-xs text-neutral-400">
              This is an org-wide skill managed by an admin.
            </p>
          </div>
        )}

        {canEdit && (
          <form action={deleteSkill.bind(null, skill.id)} className="mt-4">
            <Button type="submit" variant="danger" size="sm">
              Delete skill
            </Button>
          </form>
        )}
      </Card>
    </PageShell>
  );
}
