"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { companies, memberships, users } from "@/lib/db/schema";
import { requireSuperadmin } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/password";

export async function setCompanyEntitledMajor(
  companyId: string,
  formData: FormData,
) {
  await requireSuperadmin();
  const parsed = Number.parseInt(String(formData.get("entitledMajor") ?? ""), 10);
  if (!Number.isInteger(parsed)) return;
  const entitledMajor = Math.min(99, Math.max(0, parsed));
  await db
    .update(companies)
    .set({ desktopEntitledMajor: entitledMajor })
    .where(eq(companies.id, companyId));
  revalidatePath("/owner");
}

export type CreateCompanyState = {
  error?: string;
  ok?: boolean;
  email?: string;
  tempPassword?: string;
};

const createCompanySchema = z.object({
  companyName: z.string().trim().min(1, "Enter the company name"),
  adminName: z.string().trim().min(1, "Enter the admin's name"),
  adminEmail: z.string().trim().email("Enter a valid email"),
});

/**
 * Provisions a new client business: the company row, its first user (app
 * role ADMIN so they can manage their own /admin), and the OWNER membership
 * (which also keeps ensureCompanyForUser from auto-creating a phantom
 * company on their first sign-in). The generated temp password is returned
 * once for hand-off and never persisted in plaintext.
 */
export async function createCompanyWithAdmin(
  _prev: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  await requireSuperadmin();
  const parsed = createCompanySchema.safeParse({
    companyName: formData.get("companyName"),
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.adminEmail.toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing[0]) {
    return { error: "An account with that email already exists." };
  }

  // 9 random bytes -> 12 base64url chars; comfortably over MIN_PASSWORD_LENGTH.
  const tempPassword = randomBytes(9).toString("base64url");
  try {
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: parsed.data.adminName,
        passwordHash: await hashPassword(tempPassword),
        role: "ADMIN",
      })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: parsed.data.companyName })
      .returning();
    await db.insert(memberships).values({
      companyId: company.id,
      userId: user.id,
      role: "OWNER",
    });
  } catch {
    return { error: "Could not create the company. Please try again." };
  }
  revalidatePath("/owner");
  return { ok: true, email, tempPassword };
}
