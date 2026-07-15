import Link from "next/link";
import { BackButton } from "./back-button";

/**
 * Standalone shell for the legal documents — public (no auth; middleware
 * lists /legal in PUBLIC_PATHS), no app chrome, readable in and out of the
 * desktop shell.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ember-bg">
      <header className="border-b border-ember-border bg-ember-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <BackButton />
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            C
          </div>
          <div className="font-serif text-sm font-semibold text-ember-text">
            {process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI"}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-6 pb-10 text-sm text-ember-faint">
        <nav className="flex gap-4">
          <Link href="/legal/terms" className="hover:underline">
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className="hover:underline">
            Privacy Policy
          </Link>
          <Link href="/legal/eula" className="hover:underline">
            EULA
          </Link>
        </nav>
      </footer>
    </div>
  );
}
