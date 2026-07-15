import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { termsAccepted } from "@/lib/legal/gate";
import { getLegalDoc } from "@/lib/legal/content";
import { TERMS_VERSION } from "@/lib/legal/version";
import { Markdown } from "@/components/markdown";
import { Card } from "@/components/ui";
import { AcceptTermsForm } from "./accept-form";

export const metadata: Metadata = { title: "Terms of Service — ContractorAI" };
export const dynamic = "force-dynamic";

/**
 * Clickwrap acceptance page. Lives outside the (app) route group so the
 * layout gate can redirect here without a loop; middleware requires a
 * session (not in PUBLIC_PATHS), the gate requires only requireUser.
 */
export default async function AcceptTermsPage() {
  const user = await requireUser();
  if (termsAccepted(user)) redirect("/chat");

  const isUpdate = Boolean(
    user.termsAcceptedVersion && user.termsAcceptedVersion !== TERMS_VERSION,
  );
  const doc = getLegalDoc("terms");

  return (
    <div className="flex min-h-screen items-center justify-center bg-ember-bg p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            C
          </div>
          <h1 className="font-serif text-2xl font-semibold text-ember-text">
            {isUpdate
              ? "The Terms of Service have been updated"
              : "Review the Terms of Service"}
          </h1>
          <p className="mt-1 text-sm text-ember-muted">
            {isUpdate
              ? "Please review and accept the updated terms to continue."
              : "Please review and accept the terms to start using ContractorAI."}{" "}
            Version {doc.version}
            {doc.lastUpdated ? ` · Updated ${doc.lastUpdated}` : null}
          </p>
        </div>

        <Card className="p-6">
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-ember-border bg-ember-bg p-4">
            <Markdown content={doc.body} />
          </div>
          <div className="mt-5">
            <AcceptTermsForm />
          </div>
        </Card>
      </div>
    </div>
  );
}
