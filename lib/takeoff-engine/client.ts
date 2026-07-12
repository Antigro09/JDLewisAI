import { env } from "@/lib/env";
import type {
  EngineCorrection,
  EngineJob,
  EngineOverlay,
  EngineProject,
  EngineQuantity,
  EngineSheet,
  EngineUpload,
  ReviewRequest,
  TakeoffScope,
} from "./types";

export class EngineDownError extends Error {
  constructor(message = "Takeoff engine is not reachable.") {
    super(message);
    this.name = "EngineDownError";
  }
}

export class EngineTimeoutError extends Error {
  constructor(message = "Takeoff engine request timed out.") {
    super(message);
    this.name = "EngineTimeoutError";
  }
}

export class EngineHttpError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`Takeoff engine returned HTTP ${status}.`);
    this.name = "EngineHttpError";
  }
}

const DEFAULT_ENGINE_URL = "http://localhost:8000";
const JSON_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 120_000;

function baseUrl(): string {
  if (!env.TAKEOFF_ENGINE_URL && process.env.NODE_ENV === "production") {
    throw new EngineDownError("TAKEOFF_ENGINE_URL must be set in production.");
  }
  return (env.TAKEOFF_ENGINE_URL ?? DEFAULT_ENGINE_URL).replace(/\/+$/, "");
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function engineFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = JSON_TIMEOUT_MS,
): Promise<Response> {
  let signal: AbortSignal;
  try {
    signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  } catch {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    signal = controller.signal;
  }

  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      throw new EngineHttpError(response.status, await readErrorBody(response));
    }
    return response;
  } catch (err) {
    if (err instanceof EngineHttpError) throw err;
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new EngineTimeoutError();
    }
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new EngineTimeoutError();
    }
    throw new EngineDownError(err instanceof Error ? err.message : undefined);
  }
}

async function engineJson<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const response = await engineFetch(path, init, timeoutMs);
  return response.json() as Promise<T>;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function createProject(name: string): Promise<EngineProject> {
  return engineJson<EngineProject>("/api/projects", jsonInit("POST", { name }));
}

export function getProject(projectId: string): Promise<EngineProject> {
  return engineJson<EngineProject>(`/api/projects/${encodeURIComponent(projectId)}`);
}

export function uploadFile(projectId: string, file: File): Promise<EngineUpload> {
  const form = new FormData();
  form.append("file", file, file.name);
  return engineJson<EngineUpload>(
    `/api/projects/${encodeURIComponent(projectId)}/files`,
    { method: "POST", body: form },
    STREAM_TIMEOUT_MS,
  );
}

export function startProcess(projectId: string): Promise<{ job_id: string; status: EngineJob["status"] }> {
  return engineJson(`/api/projects/${encodeURIComponent(projectId)}/process`, { method: "POST" });
}

export function indexProject(projectId: string): Promise<{ job_id: string; status: EngineJob["status"] }> {
  return engineJson(`/api/projects/${encodeURIComponent(projectId)}/index`, { method: "POST" });
}

export function startScopedProcess(
  projectId: string,
  scope: TakeoffScope,
): Promise<{ job_id: string; status: EngineJob["status"] }> {
  return engineJson(
    `/api/projects/${encodeURIComponent(projectId)}/process`,
    jsonInit("POST", { scope }),
  );
}

export function getJob(jobId: string): Promise<EngineJob> {
  return engineJson<EngineJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function listSheets(projectId: string): Promise<EngineSheet[]> {
  return engineJson<EngineSheet[]>(`/api/projects/${encodeURIComponent(projectId)}/sheets`);
}

export function getSheetImage(sheetId: string): Promise<Response> {
  return engineFetch(`/api/sheets/${encodeURIComponent(sheetId)}/image`, {}, STREAM_TIMEOUT_MS);
}

export function getOverlay(sheetId: string): Promise<EngineOverlay> {
  return engineJson<EngineOverlay>(`/api/sheets/${encodeURIComponent(sheetId)}/overlay`);
}

export function listQuantities(
  projectId: string,
  query: { needs_review?: boolean; item_type?: string } = {},
): Promise<EngineQuantity[]> {
  const params = new URLSearchParams();
  if (query.needs_review !== undefined) params.set("needs_review", String(query.needs_review));
  if (query.item_type) params.set("item_type", query.item_type);
  const suffix = params.size ? `?${params.toString()}` : "";
  return engineJson<EngineQuantity[]>(`/api/projects/${encodeURIComponent(projectId)}/quantities${suffix}`);
}

export function getQuantity(quantityId: string): Promise<EngineQuantity> {
  return engineJson<EngineQuantity>(`/api/quantities/${encodeURIComponent(quantityId)}`);
}

export function reviewQuantity(
  quantityId: string,
  body: ReviewRequest & { reviewer: string },
): Promise<{ decision_id: string; review_status: string }> {
  return engineJson(`/api/quantities/${encodeURIComponent(quantityId)}/review`, jsonInit("POST", body));
}

export function calibrate(
  sheetId: string,
  body: { p1: [number, number]; p2: [number, number]; real_distance_ft: number },
): Promise<{ scale_id: string; ft_per_pt: number; source: string; note: string }> {
  return engineJson(`/api/sheets/${encodeURIComponent(sheetId)}/calibrate`, jsonInit("POST", body));
}

export function listCorrections(projectId: string): Promise<EngineCorrection[]> {
  return engineJson<EngineCorrection[]>(`/api/projects/${encodeURIComponent(projectId)}/corrections`);
}

export async function createExportAndDownload(projectId: string, format: string): Promise<Response> {
  const created = await engineJson<{ export_id: string; status: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/export`,
    jsonInit("POST", { format }),
    STREAM_TIMEOUT_MS,
  );
  return engineFetch(`/api/exports/${encodeURIComponent(created.export_id)}/download`, {}, STREAM_TIMEOUT_MS);
}
