import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, users, type AuditEntry } from "@/lib/db/schema";

/** Record an AI action. Never throws — auditing must not break the action. */
export async function recordAudit(opts: {
  userId: string;
  action: string;
  detail?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: opts.userId,
      action: opts.action,
      detail: opts.detail?.slice(0, 500) ?? null,
      conversationId: opts.conversationId ?? null,
    });
  } catch {
    // best-effort
  }
}

export async function listAuditLog(
  limit = 100,
): Promise<(AuditEntry & { userName: string | null })[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      action: auditLog.action,
      detail: auditLog.detail,
      conversationId: auditLog.conversationId,
      createdAt: auditLog.createdAt,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows;
}
