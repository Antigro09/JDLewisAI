import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { takeoffProjects, type AppUser, type TakeoffProject } from "@/lib/db/schema";
import {
  EngineDownError,
  EngineHttpError,
  EngineTimeoutError,
  getJob,
  getQuantity,
  listSheets,
} from "./client";
import type { EngineJob, EngineQuantity, EngineSheet } from "./types";

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export async function requireTakeoff(
  takeoffId: string,
): Promise<{ user: AppUser; row: TakeoffProject }> {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(takeoffProjects)
    .where(and(eq(takeoffProjects.id, takeoffId), eq(takeoffProjects.userId, user.id)));
  const row = rows[0];
  if (!row) throw new NotFoundError();
  return { user, row };
}

export async function assertSheetInProject(
  engineProjectId: string,
  sheetId: string,
): Promise<EngineSheet> {
  const sheets = await listSheets(engineProjectId).catch((err) => {
    if (err instanceof EngineHttpError && err.status === 404) throw new NotFoundError();
    throw err;
  });
  const sheet = sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new NotFoundError();
  return sheet;
}

export async function assertQuantityInProject(
  engineProjectId: string,
  quantityId: string,
): Promise<EngineQuantity> {
  const quantity = await getQuantity(quantityId).catch((err) => {
    if (err instanceof EngineHttpError && err.status === 404) throw new NotFoundError();
    throw err;
  });
  if (quantity.project_id !== engineProjectId) throw new NotFoundError();
  return quantity;
}

export async function assertJobInProject(
  engineProjectId: string,
  jobId: string,
): Promise<EngineJob> {
  const job = await getJob(jobId).catch((err) => {
    if (err instanceof EngineHttpError && err.status === 404) throw new NotFoundError();
    throw err;
  });
  if (job.project_id !== engineProjectId) throw new NotFoundError();
  return job;
}

function engineBody(body: unknown): unknown {
  if (typeof body === "string") return { error: body };
  return body;
}

export function takeoffErrorResponse(err: unknown): NextResponse {
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (err instanceof EngineTimeoutError) {
    return NextResponse.json({ error: "engine_down", message: err.message }, { status: 504 });
  }
  if (err instanceof EngineDownError) {
    return NextResponse.json({ error: "engine_down", message: err.message }, { status: 503 });
  }
  if (err instanceof EngineHttpError) {
    return NextResponse.json(engineBody(err.body), { status: err.status });
  }
  console.error("takeoff route failed:", err);
  return NextResponse.json({ error: "takeoff_failed" }, { status: 500 });
}
