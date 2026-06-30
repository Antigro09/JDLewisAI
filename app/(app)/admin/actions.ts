"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type Role } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/server";

export async function setUserRole(userId: string, role: Role) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // don't change your own role (avoid lockout)
  await db.update(users).set({ role }).where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function setUserDisabled(userId: string, disabled: boolean) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // can't disable yourself
  await db.update(users).set({ disabled }).where(eq(users.id, userId));
  revalidatePath("/admin");
}

export async function deleteUser(userId: string) {
  const admin = await requireAdmin();
  if (admin.id === userId) return; // can't delete yourself
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/admin");
}
