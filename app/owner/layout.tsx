import { requireSuperadmin } from "@/lib/auth/server";
import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui";

/**
 * Standalone shell for the owner console — deliberately outside the (app)
 * route group so none of the client-facing chrome (sidebar, chats, projects)
 * renders here. SUPERADMIN-only; middleware pre-filters, this enforces.
 */
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperadmin();
  return (
    <div className="min-h-screen bg-ember-bg">
      <header className="border-b border-ember-border bg-ember-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              C
            </div>
            <div>
              <div className="font-serif text-sm font-semibold text-ember-text">
                {process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI"}
              </div>
              <div className="text-xs text-ember-faint">Owner console</div>
            </div>
          </div>
          <form action={signOutAction}>
            <Button type="submit" size="sm" variant="ghost">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
