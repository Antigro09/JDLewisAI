import { countDistinct, desc, eq, sql } from "drizzle-orm";
import { requireSuperadmin } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { companies, desktopClients, memberships, users } from "@/lib/db/schema";
import { AdminStat } from "@/components/admin-stat";
import { Card, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/lib/utils";
import { setCompanyEntitledMajor } from "./actions";
import { CreateCompanyForm } from "./create-company-form";

export const dynamic = "force-dynamic";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async function OwnerPage() {
  await requireSuperadmin();

  const [companyRows, userCountRow, clientRows] = await Promise.all([
    db
      .select({
        company: companies,
        memberCount: countDistinct(memberships.userId),
      })
      .from(companies)
      .leftJoin(memberships, eq(memberships.companyId, companies.id))
      .groupBy(companies.id)
      .orderBy(desc(companies.createdAt)),
    db.select({ count: sql<number>`count(*)` }).from(users),
    db
      .select()
      .from(desktopClients)
      .orderBy(desc(desktopClients.lastSeenAt)),
  ]);

  // Most recent desktop shell seen per company (rows are ordered newest-first).
  const latestByCompany = new Map<
    string,
    { version: string; lastSeenAt: Date }
  >();
  for (const row of clientRows) {
    if (!latestByCompany.has(row.companyId)) {
      latestByCompany.set(row.companyId, {
        version: row.version,
        lastSeenAt: row.lastSeenAt,
      });
    }
  }
  const activeCutoff = Date.now() - THIRTY_DAYS_MS;
  const activeClients = clientRows.filter(
    (c) => c.lastSeenAt.getTime() >= activeCutoff,
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ember-text">
          Companies &amp; licenses
        </h1>
        <p className="mt-1 text-sm text-ember-muted">
          Every client business, their desktop update license, and the shell
          versions they&apos;re running. Patch updates always flow; a company
          only receives a new major version once their entitled major covers
          it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <AdminStat index={0} label="Companies" value={companyRows.length} />
        <AdminStat
          index={1}
          label="Users"
          value={Number(userCountRow[0]?.count ?? 0)}
        />
        <AdminStat
          index={2}
          label="Active desktops"
          value={activeClients}
          sub="update checks in the last 30 days"
        />
      </div>

      <Card className="p-0">
        <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
            Companies
          </h2>
        </div>
        {companyRows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-neutral-400">
            No companies yet — create the first one below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
                  <th className="whitespace-nowrap px-4 py-3">Company</th>
                  <th className="whitespace-nowrap px-4 py-3">Created</th>
                  <th className="whitespace-nowrap px-4 py-3">Members</th>
                  <th className="whitespace-nowrap px-4 py-3">Desktop last seen</th>
                  <th className="whitespace-nowrap px-4 py-3">Licensed major</th>
                </tr>
              </thead>
              <tbody>
                {companyRows.map(({ company, memberCount }) => {
                  const seen = latestByCompany.get(company.id);
                  return (
                    <tr
                      key={company.id}
                      className="border-b border-neutral-100 align-top dark:border-neutral-800"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-neutral-800 dark:text-neutral-100">
                        {company.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-500 dark:text-neutral-400">
                        {formatDate(company.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                        {Number(memberCount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-500 dark:text-neutral-400">
                        {seen
                          ? `v${seen.version} · ${formatDate(seen.lastSeenAt)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <form
                          action={setCompanyEntitledMajor.bind(null, company.id)}
                          className="flex items-center gap-2"
                        >
                          <Input
                            name="entitledMajor"
                            type="number"
                            min={0}
                            max={99}
                            defaultValue={company.desktopEntitledMajor}
                            className="w-20"
                            aria-label={`Licensed major version for ${company.name}`}
                          />
                          <SubmitButton size="sm" variant="secondary">
                            Save
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
          Create client company
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Provisions the business and its first admin account (they can add
          their own team from their Admin page). Sign-up is closed to the
          public — this is the only way in.
        </p>
        <div className="mt-4">
          <CreateCompanyForm />
        </div>
      </Card>
    </div>
  );
}
