import Link from "next/link";
import { AudioLines, Play, ShieldCheck } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { meetingSessions, projects } from "@/lib/db/schema";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { PageShell } from "@/components/page-shell";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";
import { createMeetingAction } from "./actions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function statusClass(status: string) {
  if (status === "active") return "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300";
  if (status === "processing") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  if (status === "complete") return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
  return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
}

export default async function MeetingsPage() {
  const user = await requireUser();
  const company = await ensureCompanyForUser(user);
  const [meetings, projectRows] = await Promise.all([
    db
      .select()
      .from(meetingSessions)
      .where(eq(meetingSessions.companyId, company.id))
      .orderBy(desc(meetingSessions.startedAt))
      .limit(50),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.ownerId, user.id))
      .orderBy(desc(projects.createdAt)),
  ]);

  return (
    <PageShell
      title="Meeting Intelligence"
      description="Capture live construction meetings, extract decisions, risks, action items, and generate branded minutes."
    >
      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <AudioLines size={18} className="text-brand-600" />
            <h2 className="font-medium text-neutral-900 dark:text-neutral-100">
              Start meeting
            </h2>
          </div>
          <form action={createMeetingAction} className="space-y-4">
            <div>
              <Label htmlFor="title">Meeting title</Label>
              <Input
                id="title"
                name="title"
                placeholder="e.g. Talbot Park OAC Coordination"
                required
              />
            </div>
            <div>
              <Label htmlFor="projectId">Project</Label>
              <Select id="projectId" name="projectId" className="w-full">
                <option value="">Not assigned</option>
                {projectRows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <input name="consentConfirmed" type="checkbox" className="mt-1" />
              <span>
                Recording consent has been confirmed. Transcript-first mode stores meeting
                text and extracted intelligence; raw audio remains off by default.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <input name="rawAudioEnabled" type="checkbox" className="mt-1" />
              <span>Store raw audio when the native capture adapter is enabled.</span>
            </label>
            <Button type="submit" className="w-full">
              <Play size={16} />
              Open live workspace
            </Button>
          </form>
          <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-200">
              <ShieldCheck size={14} />
              Privacy default
            </div>
            The app is transcript-first. Electron/WASAPI capture and AssemblyAI streaming
            plug into this workspace through the APIs now in place.
          </div>
        </Card>

        <div className="space-y-3">
          {meetings.length === 0 && (
            <Card className="p-6 text-sm text-neutral-500">
              No meeting sessions yet.
            </Card>
          )}
          {meetings.map((m) => (
            <Link key={m.id} href={`/meetings/${m.id}`}>
              <Card className="p-4 transition-colors hover:border-brand-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {m.title}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Started {formatDate(m.startedAt)}
                      {m.detectedApp ? ` · ${m.detectedApp}` : ""}
                    </div>
                  </div>
                  <Badge className={statusClass(m.status)}>{m.status}</Badge>
                </div>
                {m.summary && (
                  <p className="mt-3 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
                    {m.summary}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
