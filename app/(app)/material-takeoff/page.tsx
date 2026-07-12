import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { takeoffProjects, type TakeoffProject } from "@/lib/db/schema";
import { isGoogleConnected } from "@/lib/google/client";
import { MaterialTakeoffClient, type TakeoffListItem } from "./material-takeoff-client";

export const dynamic = "force-dynamic";

function toClient(row: TakeoffProject): TakeoffListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    engineJobId: row.engineJobId,
    jobStatus: row.jobStatus ?? null,
    jobProgress: row.jobProgress,
    jobError: row.jobError,
    takeoffInstructions: row.takeoffInstructions,
    takeoffScope: row.takeoffScope,
    processStartedAt: row.processStartedAt?.toISOString() ?? null,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default async function MaterialTakeoffPage({
  searchParams,
}: {
  searchParams?: Promise<{ t?: string }>;
}) {
  const user = await requireUser();
  const [googleConnected, rows, query] = await Promise.all([
    isGoogleConnected(user.id),
    db
      .select()
      .from(takeoffProjects)
      .where(eq(takeoffProjects.userId, user.id))
      .orderBy(desc(takeoffProjects.createdAt)),
    searchParams,
  ]);

  return (
    <MaterialTakeoffClient
      initialTakeoffs={rows.map(toClient)}
      selectedTakeoffId={query?.t}
      googleConnected={googleConnected}
    />
  );
}
