import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, users, type NotificationKind } from "@/lib/db/schema";
import { isGoogleConnected, getValidAccessToken } from "@/lib/google/client";
import { gmailSend } from "@/lib/google/gmail";

export async function createNotification(opts: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
}): Promise<void> {
  await db.insert(notifications).values({
    userId: opts.userId,
    kind: opts.kind,
    title: opts.title,
    body: opts.body ?? null,
    link: opts.link ?? null,
  });
}

export async function listNotifications(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return Number(rows[0]?.count ?? 0);
}

export async function markRead(userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.userId, userId));
}

/** Optionally email the user a copy of a notification, using their own
 * connected Gmail. Opt-in only; never throws (a failed email must not break
 * the caller — automation completion, chat turn, etc). */
export async function maybeSendEmailNotification(opts: {
  userId: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    const user = (
      await db.select().from(users).where(eq(users.id, opts.userId))
    )[0];
    if (!user || user.personalization?.emailNotifications !== true) return;
    if (!(await isGoogleConnected(user.id))) return;
    const token = await getValidAccessToken(user.id);
    await gmailSend(token, {
      to: user.email,
      subject: `ContractorAI: ${opts.title}`,
      body: opts.body,
    });
  } catch {
    // best-effort only
  }
}
