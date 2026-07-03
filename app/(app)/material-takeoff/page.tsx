import { requireUser } from "@/lib/auth/server";
import { isGoogleConnected } from "@/lib/google/client";
import { TRADES } from "@/lib/tools/material-takeoff";
import { MaterialTakeoffClient } from "./material-takeoff-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function MaterialTakeoffPage() {
  const user = await requireUser();
  const googleConnected = await isGoogleConnected(user.id);
  return <MaterialTakeoffClient trades={TRADES} googleConnected={googleConnected} />;
}
