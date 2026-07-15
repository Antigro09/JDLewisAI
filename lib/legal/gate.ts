import { redirect } from "next/navigation";
import type { AppUser } from "@/lib/db/schema";
import { TERMS_VERSION } from "./version";

/**
 * Clickwrap gate: users must accept the current Terms of Service before using
 * the app. Enforced at the page layer (app/(app)/layout.tsx) — API routes
 * enforce auth only, which is acceptable because the desktop shell UI is the
 * only client channel. Bumping TERMS_VERSION re-gates everyone automatically.
 */

export function termsAccepted(
  user: Pick<AppUser, "termsAcceptedVersion" | "role">,
): boolean {
  // The SUPERADMIN is the licensor — they don't accept their own terms.
  if (user.role === "SUPERADMIN") return true;
  return user.termsAcceptedVersion === TERMS_VERSION;
}

export async function requireTermsAccepted(user: AppUser): Promise<void> {
  if (!termsAccepted(user)) redirect("/accept-terms");
}
