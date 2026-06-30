import { desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users, usageEvents } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { deleteUser, setUserDisabled, setUserRole } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();

  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  const usageRows = await db
    .select({
      userId: usageEvents.userId,
      cost: sql<number>`coalesce(sum(${usageEvents.costCents}),0)`,
      inTok: sql<number>`coalesce(sum(${usageEvents.inputTokens}),0)`,
      outTok: sql<number>`coalesce(sum(${usageEvents.outputTokens}),0)`,
    })
    .from(usageEvents)
    .groupBy(usageEvents.userId);

  const usageByUser = new Map(usageRows.map((u) => [u.userId, u]));

  return (
    <PageShell
      title="Admin"
      description="Oversee all employee accounts and AI usage."
    >
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400">
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
                <tr key={u.id} className="border-b border-neutral-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">{u.name}</div>
                    <div className="text-xs text-neutral-400">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">{u.role}</td>
                  <td className="px-4 py-3">
                    {u.disabled ? (
                      <span className="text-red-600">Disabled</span>
                    ) : (
                      <span className="text-green-600">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
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
    </PageShell>
  );
}
