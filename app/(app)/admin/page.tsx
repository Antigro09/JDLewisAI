import { desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users, usageEvents, automationRuns } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { PLUGINS, getOrgDefaults } from "@/lib/plugins";
import { getOrgTemplate } from "@/lib/templates/render";
import { formatDate } from "@/lib/utils";
import {
  deleteUser,
  setUserDisabled,
  setUserRole,
  saveOrgPluginDefaults,
  saveDocumentTemplate,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();

  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  const [usageRows, featureRows, totalRow, automationStats] = await Promise.all([
    db
      .select({
        userId: usageEvents.userId,
        cost: sql<number>`coalesce(sum(${usageEvents.costCents}),0)`,
        inTok: sql<number>`coalesce(sum(${usageEvents.inputTokens}),0)`,
        outTok: sql<number>`coalesce(sum(${usageEvents.outputTokens}),0)`,
      })
      .from(usageEvents)
      .groupBy(usageEvents.userId),
    db
      .select({
        feature: usageEvents.feature,
        cost: sql<number>`coalesce(sum(${usageEvents.costCents}),0)`,
        calls: sql<number>`count(*)`,
      })
      .from(usageEvents)
      .groupBy(usageEvents.feature)
      .orderBy(sql`sum(${usageEvents.costCents}) desc`),
    db
      .select({
        totalCost: sql<number>`coalesce(sum(${usageEvents.costCents}),0)`,
        totalIn: sql<number>`coalesce(sum(${usageEvents.inputTokens}),0)`,
        totalOut: sql<number>`coalesce(sum(${usageEvents.outputTokens}),0)`,
      })
      .from(usageEvents),
    db
      .select({
        status: automationRuns.status,
        count: sql<number>`count(*)`,
      })
      .from(automationRuns)
      .groupBy(automationRuns.status),
  ]);

  const usageByUser = new Map(usageRows.map((u) => [u.userId, u]));
  const [orgDefaults, docTemplate] = await Promise.all([
    getOrgDefaults(),
    getOrgTemplate(),
  ]);
  const grandTotal = totalRow[0];
  const automationCounts = Object.fromEntries(automationStats.map((r) => [r.status, Number(r.count)]));

  return (
    <PageShell
      title="Admin"
      description="Oversee all employee accounts and AI usage."
    >
      <div className="space-y-6">

      {/* Cost summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Total AI Spend</div>
          <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            ${(Number(grandTotal?.totalCost ?? 0) / 100).toFixed(2)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Total Tokens</div>
          <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {(Number(grandTotal?.totalIn ?? 0) + Number(grandTotal?.totalOut ?? 0)).toLocaleString()}
          </div>
          <div className="text-xs text-neutral-400">
            {Number(grandTotal?.totalIn ?? 0).toLocaleString()} in / {Number(grandTotal?.totalOut ?? 0).toLocaleString()} out
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Automation Runs</div>
          <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {((automationCounts.success ?? 0) + (automationCounts.error ?? 0) + (automationCounts.running ?? 0))}
          </div>
          <div className="text-xs text-neutral-400">
            {automationCounts.success ?? 0} success / {automationCounts.error ?? 0} error
          </div>
        </Card>
      </div>

      {/* Usage by feature */}
      {featureRows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Cost by Feature</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                <th className="px-4 py-2">Feature</th>
                <th className="px-4 py-2">Calls</th>
                <th className="px-4 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {featureRows.map((f) => (
                <tr key={f.feature} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-2 font-medium dark:text-neutral-100">{f.feature}</td>
                  <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">{Number(f.calls).toLocaleString()}</td>
                  <td className="px-4 py-2 dark:text-neutral-200">${(Number(f.cost) / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Document branding</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Applied to the printable/PDF view of generated scopes, RFIs, change orders, daily
          reports, and EAPs.
        </p>
        <form action={saveDocumentTemplate} className="mt-4 space-y-3" encType="multipart/form-data">
          <div>
            <Label htmlFor="name">Label</Label>
            <Input id="name" name="name" defaultValue={docTemplate?.name ?? ""} placeholder="e.g. Acme Construction Letterhead" />
          </div>
          <div>
            <Label htmlFor="logo">Logo</Label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/*"
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-neutral-300"
            />
            {docTemplate?.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={docTemplate.logo} alt="Current logo" className="mt-2 h-10 w-auto" />
            )}
          </div>
          <div>
            <Label htmlFor="headerText">Header text</Label>
            <Textarea id="headerText" name="headerText" rows={2} defaultValue={docTemplate?.headerText ?? ""} />
          </div>
          <div>
            <Label htmlFor="footerText">Footer text</Label>
            <Textarea id="footerText" name="footerText" rows={2} defaultValue={docTemplate?.footerText ?? ""} />
          </div>
          <div>
            <Label htmlFor="brandColor">Brand color</Label>
            <Input id="brandColor" name="brandColor" type="text" placeholder="#ea580c" defaultValue={docTemplate?.brandColor ?? ""} />
          </div>
          <SubmitButton size="sm">Save branding</SubmitButton>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Plugin defaults (org-wide)</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Default capability state for everyone. Individual users can override in
          their own settings.
        </p>
        <form action={saveOrgPluginDefaults} className="mt-4 space-y-3">
          {PLUGINS.map((p) => (
            <label key={p.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                name={`plugin_${p.id}`}
                defaultChecked={orgDefaults[p.id] ?? p.default}
                className="mt-1"
              />
              <span>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  {p.label}
                </span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  {p.description}
                </span>
              </span>
            </label>
          ))}
          <SubmitButton size="sm">Save defaults</SubmitButton>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Usage (cost / tokens)</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allUsers.map((u) => {
              const usage = usageByUser.get(u.id);
              const cost = Number(usage?.cost ?? 0) / 100;
              const tokens =
                Number(usage?.inTok ?? 0) + Number(usage?.outTok ?? 0);
              const isSelf = u.id === admin.id;
              return (
                <tr key={u.id} className="border-b border-neutral-100 align-top dark:border-neutral-800">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800 dark:text-neutral-100">{u.name}</div>
                    <div className="text-xs text-neutral-400">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 dark:text-neutral-200">{u.role}</td>
                  <td className="px-4 py-3">
                    {u.disabled ? (
                      <span className="text-red-600 dark:text-red-400">Disabled</span>
                    ) : (
                      <span className="text-green-600 dark:text-green-400">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                    ${cost.toFixed(2)} · {tokens.toLocaleString()} tok
                  </td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className="text-xs text-neutral-400">You</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <form
                          action={setUserRole.bind(
                            null,
                            u.id,
                            u.role === "ADMIN" ? "MEMBER" : "ADMIN",
                          )}
                        >
                          <Button type="submit" size="sm" variant="secondary">
                            {u.role === "ADMIN" ? "Make member" : "Make admin"}
                          </Button>
                        </form>
                        <form
                          action={setUserDisabled.bind(null, u.id, !u.disabled)}
                        >
                          <Button type="submit" size="sm" variant="ghost">
                            {u.disabled ? "Enable" : "Disable"}
                          </Button>
                        </form>
                        <form action={deleteUser.bind(null, u.id)}>
                          <Button type="submit" size="sm" variant="danger">
                            Delete
                          </Button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      </div>
    </PageShell>
  );
}
