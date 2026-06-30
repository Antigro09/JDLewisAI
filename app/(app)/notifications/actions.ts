"use server";

import { requireUser } from "@/lib/auth/server";
import { markRead, markAllRead } from "@/lib/notifications";

export async function markNotificationRead(id: string) {
  const user = await requireUser();
  await markRead(user.id, id);
}

export async function markAllNotificationsRead() {
  const user = await requireUser();
  await markAllRead(user.id);
}
