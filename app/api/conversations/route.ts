import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { listConversations } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conversations = await listConversations(user.id);
  return NextResponse.json({ conversations });
}
