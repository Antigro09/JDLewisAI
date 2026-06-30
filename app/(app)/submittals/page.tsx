import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { submittals } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { listProjects } from "@/lib/data";
import { createSubmittalAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SubmittalsPage() {
  const user = await requireUser();
  const [rows, projects] = await Promise.all([
    db.select().from(submittals).where(eq(submittals.userId, user.id)).orderBy(desc(submittals.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="Submittal Log"
      description="Track shop drawings, product data, and other submittals through review."
    >
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-medium">Add Submittal</h2>
        <form action={createSubmittalAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input id="title" name="title" required placeholder="e.g. Electrical Panel Shop Drawings" />
            </div>
            <div>
              <Label htmlFor="specSection">Spec Section</Label>
              <Input id="specSection" name="specSection" placeholder="e.g. 26 24 16" />
            </div>
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={2} placeholder="Describe what's being submitted…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="projectId">Project</Label>
              <Select id="projectId" name="projectId">
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ballInCourt">Ball in Court</Label>
              <Input id="ballInCourt" name="ballInCourt" placeholder="GC, Architect, Owner…" />
            </div>
            <div>
              <Label htmlFor="dueDate">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </div>
          </div>
          <SubmitButton pendingText="Adding…">Add Submittal</SubmitButton>
        </form>
      </Card>

      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No submittals yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                <th className="pb-2 pr-4">Title</th>
                <th className="pb-2 pr-4">Spec</th>
                <th className="pb-2 pr-4">Ball in Court</th>
                <th className="pb-2 pr-4">Due</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
                  <td className="py-2 pr-4">
                    <Link href={`/submittals/${s.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      {s.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-neutral-500 dark:text-neutral-400">{s.specSection ?? "—"}</td>
                  <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-300">{s.ballInCourt ?? "—"}</td>
                  <td className="py-2 pr-4 text-neutral-500 dark:text-neutral-400">{s.dueDate ?? "—"}</td>
                  <td className="py-2 pr-4"><StatusBadge status={s.status} /></td>
                  <td className="py-2 text-neutral-400">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
