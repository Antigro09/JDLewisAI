"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, documentTemplates, companies, type Role } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/server";
import { ensureCompanyForUser } from "@/lib/meetings/access";
import { PLUGINS, setOrgPlugin } from "@/lib/plugins";
import { getOrgTemplate } from "@/lib/templates/render";
import { readUploadOrThrow } from "@/lib/uploads";

/** Only a SUPERADMIN may touch a SUPERADMIN account or hand out the role —
 * otherwise a company ADMIN could escalate themselves or lock out the owner. */
async function assertCanModify(actorRole: Role, userId: string): Promise<boolean> {
  if (actorRole === "SUPERADMIN") return true;
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0] !== undefined && rows[0].role !== "SUPERADMIN";
}

export async function setUserRole(userId: string, role: Role) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // don't change your own role (avoid lockout)
  if (role === "SUPERADMIN" && admin.role !== "SUPERADMIN") return;
  if (!(await assertCanModify(admin.role, userId))) return;
  // tokenVersion bump revokes the user's outstanding sessions so the new role
  // takes effect immediately, not at next sign-in.
  await db
    .update(users)
    .set({ role, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function setUserDisabled(userId: string, disabled: boolean) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // can't disable yourself
  if (!(await assertCanModify(admin.role, userId))) return;
  await db
    .update(users)
    .set({ disabled, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function deleteUser(userId: string) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // can't delete yourself
  if (!(await assertCanModify(admin.role, userId))) return;
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function saveOrgPluginDefaults(formData: FormData) {
  await requireAdmin();
  for (const p of PLUGINS) {
    await setOrgPlugin(p.id, formData.get(`plugin_${p.id}`) === "on");
  }
  revalidatePath("/admin");
}

/**
 * Meeting recording governance (companies row): transcript retention window
 * and the recording-consent policy. Blank/invalid retention = null = keep
 * transcripts forever; the retention janitor only purges when it's set.
 */
export async function saveMeetingGovernance(formData: FormData) {
  const admin = await requireAdmin();
  const company = await ensureCompanyForUser(admin);

  const rawDays = String(formData.get("transcriptRetentionDays") ?? "").trim();
  const parsedDays = Number.parseInt(rawDays, 10);
  const transcriptRetentionDays =
    Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : null;

  await db
    .update(companies)
    .set({
      transcriptRetentionDays,
      recordingConsentRequired: formData.get("recordingConsentRequired") === "on",
      recordingConsentText:
        String(formData.get("recordingConsentText") ?? "").trim() || null,
    })
    .where(eq(companies.id, company.id));
  revalidatePath("/admin");
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function saveDocumentTemplate(formData: FormData) {
  await requireAdmin();
  const existing = await getOrgTemplate();

  let logo = existing?.logo ?? null;
  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    const buf = await readUploadOrThrow(file, { maxBytes: MAX_LOGO_BYTES });
    logo = `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;
  }

  const values = {
    kind: "general" as const,
    name: String(formData.get("name") ?? "").trim() || "Company branding",
    logo,
    headerText: String(formData.get("headerText") ?? "").trim() || null,
    footerText: String(formData.get("footerText") ?? "").trim() || null,
    brandColor: String(formData.get("brandColor") ?? "").trim() || null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(documentTemplates)
      .set(values)
      .where(eq(documentTemplates.id, existing.id));
  } else {
    await db.insert(documentTemplates).values(values);
  }
  revalidatePath("/admin");
}
