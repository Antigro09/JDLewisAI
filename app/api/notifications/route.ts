import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { listNotifications, unreadCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [items, unread] = await Promise.all([
    listNotifications(user.id),
    unreadCount(user.id),
  ]);
  return NextResponse.json({ notifications: items, unreadCount: unread });
}
