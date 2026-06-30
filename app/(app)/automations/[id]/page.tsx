import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { automations, automationRuns } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { INTERVAL_OPTIONS } from "@/lib/automations/intervals";
import {
  updateAutomation,
  setAutomationStatus,
  deleteAutomation,
  runAutomationNow,
} from "../actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const a = (
    await db.select().from(automations).where(eq(automations.id, id))
  )[0];
  if (!a || a.ownerId !== user.id) notFound();

  const runs = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, id))
    .orderBy(desc(automationRuns.startedAt))
    .limit(20);

  const active = a.status === "active";

  return (
    <PageShell
      title={a.name}
      description={active ? "Active — runs on schedule." : "Paused."}
      action={
        <div className="flex gap-2">
          <form action={runAutomationNow.bind(null, a.id)}>
            <SubmitButton size="sm" pendingText="Running…">
              Run now
            </SubmitButton>
          </form>
          <form
            action={setAutomationStatus.bind(
              null,
              a.id,
              active ? "paused" : "active",
            )}
          >
            <Button type="submit" size="sm" variant="secondary">
              {active ? "Pause" : "Resume"}
            </Button>
          </form>
          <Link href="/automations">
            <Button variant="secondary" size="sm">
              All
            </Button>
          </Link>
        </div>
      }
    >
      {a.lastError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Last run error: {a.lastError}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-medium">Configuration</h2>
          <form action={updateAutomation.bind(null, a.id)} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={a.name} required />
            </div>
            <div>
              <Label htmlFor="instructions">Instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={6}
                defaultValue={a.instructions}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="intervalMinutes">Runs</Label>
                <Select
                  id="intervalMinutes"
                  name="intervalMinutes"
                  defaultValue={String(a.intervalMinutes)}
                  className="h-10 w-full"
                >
                  {INTERVAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Select
                  id="model"
                  name="model"
                  defaultValue={a.model ?? "claude-sonnet-4-6"}
                  className="h-10 w-full"
                >
                  {MODELS.filter((m) => m.enabled).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="effort">Effort</Label>
              <Select
                id="effort"
                name="effort"
                defaultValue={a.effort ?? "medium"}
                className="h-10 w-full"
              >
                {ALL_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>

          <form action={deleteAutomation.bind(null, a.id)} className="mt-4">
            <Button type="submit" variant="danger" size="sm">
              Delete automation
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-medium">Run history</h2>
          {runs.length === 0 && (
            <p className="text-sm text-neutral-500">No runs yet. Use “Run now” to test.</p>
          )}
          <div className="space-y-3">
            {runs.map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <Badge
                    className={
                      r.status === "success"
                        ? "bg-green-100 text-green-700"
                        : r.status === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-neutral-100 text-neutral-500"
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="text-xs text-neutral-400">
                    {formatDate(r.startedAt)}
                  </span>
                </div>
                {r.summary && (
                  <p className="mt-2 text-sm text-neutral-700">{r.summary}</p>
                )}
                {r.error && (
                  <p className="mt-2 text-sm text-red-600">{r.error}</p>
                )}
                {r.conversationId && (
                  <Link
                    href={`/chat/${r.conversationId}`}
                    className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline"
                  >
                    View transcript →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
