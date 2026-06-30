import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { scopesOfWork, type ScopeSections } from "@/lib/db/schema";
import { PageShell } from "@/components/page-shell";
import { Button, Card } from "@/components/ui";
import { DownloadButton } from "@/components/download-button";
import { scopeToMarkdown } from "@/lib/tools/scope";
import { deleteScope } from "../actions";

export const dynamic = "force-dynamic";

const SECTION_META: { key: keyof ScopeSections; label: string }[] = [
  { key: "workIncluded", label: "Work Included" },
  { key: "exclusions", label: "Exclusions" },
  { key: "assumptions", label: "Assumptions" },
  { key: "requiredInspections", label: "Required Inspections" },
  { key: "requiredPermits", label: "Required Permits" },
  { key: "requiredSubmittals", label: "Required Submittals" },
  { key: "closeoutRequirements", label: "Closeout Requirements" },
];

export default async function ScopeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const scope = (
    await db.select().from(scopesOfWork).where(eq(scopesOfWork.id, id))
  )[0];
  if (!scope || scope.userId !== user.id) notFound();

  const md = scopeToMarkdown(scope.title, scope.sections);
  const filename = `${scope.trade.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-scope.md`;

  return (
    <PageShell
      title={scope.title}
      description="Review, download, or copy into your bid documents."
      action={
        <div className="flex gap-2">
          <DownloadButton content={md} filename={filename} label="Download .md" />
          <Link href={`/print/scope/${scope.id}`}>
            <Button variant="secondary" size="sm">
              View branded
            </Button>
          </Link>
          <Link href="/scopes">
            <Button variant="secondary" size="sm">
              All scopes
            </Button>
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {SECTION_META.map(({ key, label }) => {
          const items = scope.sections[key] ?? [];
          return (
            <Card key={key} className="p-5">
              <h3 className="mb-2 font-semibold text-neutral-900">{label}</h3>
              {items.length === 0 ? (
                <p className="text-sm text-neutral-400">None specified.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
                  {items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <form action={deleteScope.bind(null, scope.id)} className="mt-6">
        <Button type="submit" variant="danger" size="sm">
          Delete scope
        </Button>
      </form>
    </PageShell>
  );
}
