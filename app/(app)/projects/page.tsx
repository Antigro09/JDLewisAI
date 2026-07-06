import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { FolderOpen } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { createProject } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, user.id))
    .orderBy(desc(projects.createdAt));

  return (
    <PageShell
      title="Projects"
      description="Group context, files, and instructions per job. Selected in chat to ground answers."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-medium">New project</h2>
          <form action={createProject} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="e.g. Maple St. Office TI" required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" placeholder="Short summary" />
            </div>
            <div>
              <Label htmlFor="instructions">Context / instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={4}
                placeholder="Standing context the AI should always use for this project…"
              />
            </div>
            <Button type="submit">Create project</Button>
          </form>
        </Card>

        <div className="space-y-3">
          {rows.length === 0 && (
            <p className="text-sm text-ember-faint">No projects yet.</p>
          )}
          {rows.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block">
              <Card className="p-5 transition-[transform,box-shadow] duration-200 ease-ember-spring hover:-translate-y-2 hover:scale-[1.01] hover:shadow-ember-card-hover">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[12px] bg-ember-tint text-ember-tint-text">
                  <FolderOpen size={20} />
                </div>
                <div className="text-[16.5px] font-semibold text-ember-text">
                  {p.name}
                </div>
                {p.description && (
                  <div className="mt-0.5 text-sm text-ember-faint">
                    {p.description}
                  </div>
                )}
                <div className="mt-2 text-xs text-ember-faint">
                  Created {formatDate(p.createdAt)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
