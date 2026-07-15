"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { recordAudit } from "@/lib/audit";
import { TERMS_VERSION } from "@/lib/legal/version";

export type AcceptTermsState = { error?: string };

/**
 * Records clickwrap acceptance: the user's row holds the latest accepted
 * version + timestamp; the append-only audit log keeps the full acceptance
 * history across version bumps.
 */
export async function acceptTermsAction(
  _prev: AcceptTermsState,
  formData: FormData,
): Promise<AcceptTermsState> {
  // Only requireUser here — never the terms gate itself (no recursion).
  const user = await requireUser();
  if (formData.get("agree") !== "on") {
    return { error: "You must check the box to agree before continuing." };
  }
  await db
    .update(users)
    .set({ termsAcceptedAt: new Date(), termsAcceptedVersion: TERMS_VERSION })
    .where(eq(users.id, user.id));
  await recordAudit({
    userId: user.id,
    action: "legal.terms_accept",
    detail: `version ${TERMS_VERSION}`,
  });
  redirect("/chat");
}
