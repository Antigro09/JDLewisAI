import { NextResponse } from "next/server";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { automations } from "@/lib/db/schema";
import { runAutomation } from "@/lib/automations/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.status, "active"),
        or(isNull(automations.nextRunAt), lte(automations.nextRunAt, now)),
      ),
    )
    .limit(25);

  let ran = 0;
  for (const a of due) {
    // Claim immediately by advancing nextRunAt so a slow tick can't double-run it.
    await db
      .update(automations)
      .set({ nextRunAt: new Date(Date.now() + a.intervalMinutes * 60_000) })
      .where(eq(automations.id, a.id));
    try {
      await runAutomation(a.id);
      ran++;
    } catch {
      // Errors are recorded inside runAutomation.
    }
  }

  return NextResponse.json({ checked: due.length, ran });
}

// Vercel Cron issues GET with `Authorization: Bearer $CRON_SECRET`.
export const GET = handle;
// Allow POST for external pingers too.
export const POST = handle;
