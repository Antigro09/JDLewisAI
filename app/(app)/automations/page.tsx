import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { automations } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Badge, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MODELS, ALL_EFFORTS } from "@/lib/claude/models";
import { isGoogleConnected } from "@/lib/google/client";
import { INTERVAL_OPTIONS, intervalLabel } from "@/lib/automations/intervals";
import { createAutomation } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await requireUser();
  const [rows, googleConnected] = await Promise.all([
    db
      .select()
      .from(automations)
      .where(eq(automations.ownerId, user.id))
      .orderBy(desc(automations.createdAt)),
    isGoogleConnected(user.id),
  ]);

  return (
    <PageShell
      title="Automations"
      description="Describe a recurring task in plain language. It runs on a schedule using your Google connection — reading mail/files, updating sheets, drafting (and, if you allow it, sending) emails."
    >
      {!googleConnected && (
        <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Most automations need Google.{" "}
          <Link href="/settings" className="font-medium underline">
            Connect your account
          </Link>{" "}
          first.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-medium">New automation</h2>
          <form action={createAutomation} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="e.g. Log bid emails to sheet" required />
            </div>
            <div>
              <Label htmlFor="instructions">What should it do?</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={5}
                required
                placeholder="e.g. Find new emails labeled 'bids' since the last run and append the sender, subject, and date as a row to the Google Sheet titled 'Bid Tracker'."
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="intervalMinutes">Runs</Label>
                <Select
                  id="intervalMinutes"
                  name="intervalMinutes"
                  defaultValue="60"
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
                <Select id="model" name="model" defaultValue="claude-sonnet-4-6" className="h-10 w-full">
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
              <Select id="effort" name="effort" defaultValue="medium" className="h-10 w-full">
                {ALL_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input type="checkbox" name="enabled" defaultChecked />
              Enable immediately
            </label>
            <div className="flex flex-wrap items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input type="checkbox" id="allowSend" name="allowSend" className="peer mt-0.5" />
              <label htmlFor="allowSend" className="flex-1">
                Allow sending email
                <span className="mt-0.5 block text-xs text-neutral-400">
                  Off by default, this automation only drafts emails. Turn on to let it send
                  email unattended — sends are limited to the recipients and daily cap below.
                </span>
              </label>
              <div className="hidden w-full space-y-3 peer-checked:block">
                <div>
                  <Label htmlFor="sendAllowlist">Allowed recipients</Label>
                  <Textarea
                    id="sendAllowlist"
                    name="sendAllowlist"
                    rows={3}
                    placeholder={"alice@example.com\n@yourcompany.com"}
                  />
                  <p className="mt-1 text-xs text-neutral-400">
                    One address or @domain per line. Unattended sends are rejected unless
                    every recipient matches. Empty = no unattended sends at all.
                  </p>
                </div>
                <div>
                  <Label htmlFor="maxSendsPerDay">Max sends per day</Label>
                  <Input
                    id="maxSendsPerDay"
                    name="maxSendsPerDay"
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={10}
                    className="w-28"
                  />
                </div>
              </div>
            </div>
            <SubmitButton>Create automation</SubmitButton>
          </form>
        </Card>

        <div className="space-y-3">
          <h2 className="font-medium">Your automations</h2>
          {rows.length === 0 && (
            <p className="text-sm text-neutral-500">No automations yet.</p>
          )}
          {rows.map((a) => (
            <Link key={a.id} href={`/automations/${a.id}`}>
              <Card className="p-4 transition-colors hover:border-brand-300">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{a.name}</div>
                  <Badge
                    className={
                      a.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-neutral-100 text-neutral-500"
                    }
                  >
                    {a.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {intervalLabel(a.intervalMinutes)} ·{" "}
                  {a.lastRunAt ? `last run ${formatDate(a.lastRunAt)}` : "not run yet"}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
