import { requireUser } from "@/lib/auth/server";
import { MaterialTakeoffClient } from "./material-takeoff-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function MaterialTakeoffPage() {
  await requireUser();
  return <MaterialTakeoffClient />;
}
