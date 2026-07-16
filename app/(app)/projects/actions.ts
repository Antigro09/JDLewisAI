"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/server";
import { readUploadOrThrow, normalizeUploadMime } from "@/lib/uploads";
import { ensureProjectFileEmbeddings } from "@/lib/retrieval";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function ownProjectOrThrow(userId: string, projectId: string) {
  const p = (
    await db.select().from(projects).where(eq(projects.id, projectId))
  )[0];
  if (!p || p.ownerId !== userId) throw new Error("Not found");
  return p;
}

export async function createProject(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const inserted = await db
    .insert(projects)
    .values({
      ownerId: user.id,
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
    })
    .returning();
  redirect(`/projects/${inserted[0].id}`);
}

export async function updateProject(projectId: string, formData: FormData) {
  const user = await requireUser();
  await ownProjectOrThrow(user.id, projectId);
  await db
    .update(projects)
    .set({
      name: String(formData.get("name") ?? "").trim() || "Untitled project",
      description: String(formData.get("description") ?? "").trim() || null,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
    })
    .where(eq(projects.id, projectId));
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProject(projectId: string) {
  const user = await requireUser();
  await ownProjectOrThrow(user.id, projectId);
  await db.delete(projects).where(eq(projects.id, projectId));
  redirect("/projects");
}

export async function uploadProjectFile(projectId: string, formData: FormData) {
  const user = await requireUser();
  await ownProjectOrThrow(user.id, projectId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  // Enforces the size ceiling and magic-byte/MIME consistency.
  const buf = await readUploadOrThrow(file, { maxBytes: MAX_FILE_BYTES });
  // Revision handling: re-uploading a file with the same name replaces the
  // prior one (its embeddings cascade-delete) so search never cites a
  // superseded revision alongside the current one.
  await db
    .delete(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.name, file.name)));
  await db.insert(projectFiles).values({
    projectId,
    name: file.name,
    mime: normalizeUploadMime(file.name, file.type),
    sizeBytes: file.size,
    data: buf.toString("base64"),
  });
  // Index in the background so the first search doesn't pay for chunking and
  // embedding inline. ensureProjectFileEmbeddings never throws (it logs), and
  // the search route keeps a backstop call for anything this misses.
  void ensureProjectFileEmbeddings(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProjectFile(projectId: string, fileId: string) {
  const user = await requireUser();
  await ownProjectOrThrow(user.id, projectId);
  await db
    .delete(projectFiles)
    .where(and(eq(projectFiles.id, fileId), eq(projectFiles.projectId, projectId)));
  revalidatePath(`/projects/${projectId}`);
}
