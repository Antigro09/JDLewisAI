import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { scopesOfWork } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Card, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { TRADES } from "@/lib/tools/trades";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { listProjects } from "@/lib/data";
import { generateScopeAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ScopesPage() {
  const user = await requireUser();
  const [rows, projects] = await Promise.all([
    db
      .select()
      .from(scopesOfWork)
      .where(eq(scopesOfWork.userId, user.id))
      .orderBy(desc(scopesOfWork.createdAt)),
    listProjects(user.id),
  ]);

  return (
    <PageShell
      title="Scope of Work generator"
      description="Generate a structured scope for any trade — work included, exclusions, assumptions, inspections, permits, submittals, and closeout."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-medium">Generate a scope</h2>
          <form action={generateScopeAction} className="space-y-3">
            <div>
              <Label htmlFor="trade">Trade</Label>
              <Select id="trade" name="trade" className="h-10 w-full" required>
                {TRADES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="projectId">Project (optional)</Label>
              <Select id="projectId" name="projectId" className="h-10 w-full">
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="details">Project details / special conditions</Label>
              <Textarea
                id="details"
                name="details"
                rows={4}
                placeholder="Optional: scope notes, building type, phasing, special requirements…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="model">Model</Label>
                <Select id="model" name="model" className="h-10 w-full">
                  {MODELS.filter((m) => m.enabled).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="effort">Effort</Label>
                <Select id="effort" name="effort" defaultValue="high" className="h-10 w-full">
                  {ALL_EFFORTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <SubmitButton pendingText="Generating…">Generate scope</SubmitButton>
          </form>
        </Card>

        <div className="space-y-3">
          <h2 className="font-medium">Saved scopes</h2>
          {rows.length === 0 && (
            <p className="text-sm text-neutral-500">No scopes generated yet.</p>
          )}
          {rows.map((s) => (
            <Link key={s.id} href={`/scopes/${s.id}`}>
              <Card className="p-4 transition-colors hover:border-brand-300">
                <div className="font-medium">{s.title}</div>
                <div className="mt-1 text-xs text-neutral-400">
                  {formatDate(s.createdAt)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
