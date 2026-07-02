import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness check for load balancer target groups. Deliberately does not touch
 * the database — a degraded DB shouldn't make the LB mark a healthy app
 * instance as unhealthy and pull it from rotation.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
