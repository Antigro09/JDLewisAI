import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import {
  deleteProject,
  deleteProjectFile,
  updateProject,
  uploadProjectFile,
} from "../actions";

export const dynamic = "force-dynamic";

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const project = (
    await db.select().from(projects).where(eq(projects.id, id))
  )[0];
  if (!project || project.ownerId !== user.id) notFound();

  const files = await db
    .select({
      id: projectFiles.id,
      name: projectFiles.name,
      mime: projectFiles.mime,
      sizeBytes: projectFiles.sizeBytes,
    })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, id));

  return (
    <PageShell
      title={project.name}
      description="Edit standing context and attach files used to ground chats in this project."
      action={
        <Link href="/projects">
          <Button variant="secondary" size="sm">
            All projects
          </Button>
        </Link>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-medium">Details</h2>
          <form action={updateProject.bind(null, project.id)} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={project.name} required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                defaultValue={project.description ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="instructions">Context / instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={8}
                defaultValue={project.instructions ?? ""}
              />
            </div>
            <Button type="submit">Save</Button>
          </form>

          <form action={deleteProject.bind(null, project.id)} className="mt-4">
            <Button type="submit" variant="danger" size="sm">
              Delete project
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-medium">Context files</h2>
          <form
            action={uploadProjectFile.bind(null, project.id)}
            className="mb-4 space-y-2"
          >
            <input
              type="file"
              name="file"
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            />
            <Button type="submit" size="sm" variant="secondary">
              Upload file
            </Button>
            <p className="text-xs text-neutral-400">
              Text files are injected as context; images & PDFs are listed for
              reference. Max 10 MB.
            </p>
          </form>

          <div className="space-y-2">
            {files.length === 0 && (
              <p className="text-sm text-neutral-500">No files yet.</p>
            )}
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="text-xs text-neutral-400">
                    {f.mime} · {fmtSize(f.sizeBytes)}
                  </div>
                </div>
                <form action={deleteProjectFile.bind(null, project.id, f.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
