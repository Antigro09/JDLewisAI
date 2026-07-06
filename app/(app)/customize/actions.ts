"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts, skills, skillFiles } from "@/lib/db/schema";
import { requireUser, requireAdmin } from "@/lib/auth/server";
import { readUploadOrThrow } from "@/lib/uploads";
import { PLUGINS, setUserPlugin } from "@/lib/plugins";
import { parseSkillMd } from "@/lib/skills/parse-skill-md";
import { createAnthropicSkill, type UploadableFile } from "@/lib/skills/anthropic-skill";
import {
  addMcpConnection,
  removeMcpConnection,
  setMcpConnectionEnabled,
  setMcpToolPolicy,
  uniqueMcpName,
} from "@/lib/mcp/connections";
import { getCatalogEntry } from "@/lib/mcp/catalog";
import { BUILTIN_SKILLS } from "@/lib/skills/builtin";
import { createMemory, deleteMemory, MEMORY_CATEGORIES } from "@/lib/memory";
import { createPrompt, deletePrompt } from "@/lib/prompts";
import type { MemoryCategory } from "@/lib/db/schema";

export async function disconnectGoogle() {
  const user = await requireUser();
  await db.delete(googleAccounts).where(eq(googleAccounts.userId, user.id));
  revalidatePath("/customize");
}

export async function savePluginPrefs(formData: FormData) {
  const user = await requireUser();
  for (const p of PLUGINS) {
    await setUserPlugin(user.id, p.id, formData.get(`plugin_${p.id}`) === "on");
  }
  revalidatePath("/customize");
}

export type McpConnectState = { error?: string };

export async function connectMcpServer(
  _prev: McpConnectState,
  formData: FormData,
): Promise<McpConnectState> {
  const user = await requireUser();
  const serverId = String(formData.get("serverId") ?? "custom").trim() || "custom";
  const url = String(formData.get("url") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const catalog = getCatalogEntry(serverId);
  const label = catalog?.label || String(formData.get("name") ?? "").trim();

  if (!label) return { error: "Give the server a name." };
  if (!/^https:\/\//i.test(url)) return { error: "Server URL must start with https://" };

  const name = await uniqueMcpName(user.id, catalog ? serverId : label);
  await addMcpConnection(user.id, { serverId, name, url, token: token || undefined });
  revalidatePath("/customize");
  return {};
}

export async function disconnectMcpServer(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await removeMcpConnection(user.id, id);
  revalidatePath("/customize");
}

export async function toggleMcpServer(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setMcpConnectionEnabled(user.id, id, formData.get("enabled") === "on");
  revalidatePath("/customize");
}

export async function updateMcpToolPolicy(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const allowedTools = String(formData.get("allowedTools") ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  await setMcpToolPolicy(user.id, id, {
    allowWrites: formData.get("allowWrites") === "on",
    allowedTools: allowedTools.length ? allowedTools : null,
  });
  revalidatePath("/customize");
}

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

export type SkillUploadState = { error?: string };

export async function createSkillFromMarkdown(
  _prev: SkillUploadState,
  formData: FormData,
): Promise<SkillUploadState> {
  const user = await requireUser();
  const file = formData.get("skillMd");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a SKILL.md file." };
  }
  if (file.size > MAX_REFERENCE_BYTES) {
    return { error: "SKILL.md exceeds 5 MB." };
  }

  let parsed;
  let rawText: string;
  try {
    rawText = await file.text();
    parsed = parseSkillMd(rawText);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not parse SKILL.md." };
  }

  const nameOverride = String(formData.get("name") ?? "").trim();
  const descriptionOverride = String(formData.get("description") ?? "").trim();
  const defaultActive = formData.get("defaultActive") === "on";
  const scope =
    user.role === "ADMIN" && formData.get("scope") === "org" ? "org" : "personal";

  const referenceFiles = formData
    .getAll("referenceFiles")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const refBuffers: UploadableFile[] = [];
  for (const f of referenceFiles) {
    try {
      // Enforces the size ceiling and magic-byte/MIME consistency.
      const bytes = await readUploadOrThrow(f, { maxBytes: MAX_REFERENCE_BYTES });
      refBuffers.push({
        name: f.name,
        mime: f.type || "application/octet-stream",
        bytes,
      });
    } catch (err) {
      return {
        error: `"${f.name}": ${err instanceof Error ? err.message : "invalid file"}`,
      };
    }
  }

  let skillId: string;
  try {
    const inserted = await db
      .insert(skills)
      .values({
        ownerId: user.id,
        scope,
        name: nameOverride || parsed.name,
        description: descriptionOverride || parsed.description || null,
        instructions: parsed.instructions,
        defaultActive,
      })
      .returning();
    skillId = inserted[0].id;

    await db.insert(skillFiles).values({
      skillId,
      name: file.name || "SKILL.md",
      mime: "text/markdown",
      data: Buffer.from(rawText, "utf8").toString("base64"),
      kind: "primary",
    });

    for (const ref of refBuffers) {
      await db.insert(skillFiles).values({
        skillId,
        name: ref.name,
        mime: ref.mime,
        data: ref.bytes.toString("base64"),
        kind: "reference",
      });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save skill." };
  }

  // Skills that ship reference files run in an Anthropic code-execution
  // container — upload them to the Skills API and flag exec_in_container. This
  // is best-effort: on failure the skill stays a local text pack. Text-only
  // skills skip the upload entirely (zero container cost).
  if (refBuffers.length > 0) {
    const created = await createAnthropicSkill({
      displayTitle: nameOverride || parsed.name,
      skillMd: rawText,
      referenceFiles: refBuffers,
    });
    if (created) {
      await db
        .update(skills)
        .set({
          anthropicSkillId: created.id,
          anthropicSkillVersion: created.version,
          execInContainer: true,
        })
        .where(eq(skills.id, skillId));
    }
  }

  redirect("/customize?tab=skills");
}

export async function addMemory(formData: FormData) {
  const user = await requireUser();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  const catRaw = String(formData.get("category") ?? "other");
  const category = (MEMORY_CATEGORIES.some((c) => c.id === catRaw)
    ? catRaw
    : "other") as MemoryCategory;
  const scope =
    user.role === "ADMIN" && formData.get("scope") === "org" ? "org" : "personal";
  await createMemory({ ownerId: user.id, scope, category, content });
  revalidatePath("/customize");
}

export async function removeMemory(id: string) {
  const user = await requireUser();
  await deleteMemory(user.id, id);
  revalidatePath("/customize");
}

export async function addPrompt(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return;
  const scope =
    user.role === "ADMIN" && formData.get("scope") === "org" ? "org" : "personal";
  await createPrompt({ ownerId: user.id, scope, title, body });
  revalidatePath("/customize");
}

export async function removePrompt(id: string) {
  const user = await requireUser();
  await deletePrompt(user.id, id);
  revalidatePath("/customize");
}

/** Install the built-in construction workflow skills org-wide (admin only),
 * skipping any already present by name. Idempotent. */
export async function installBuiltinSkills() {
  const admin = await requireAdmin();
  const names = BUILTIN_SKILLS.map((s) => s.name);
  const existing = await db
    .select({ name: skills.name })
    .from(skills)
    .where(and(eq(skills.scope, "org"), inArray(skills.name, names)));
  const have = new Set(existing.map((e) => e.name));
  const toInsert = BUILTIN_SKILLS.filter((s) => !have.has(s.name));
  if (toInsert.length > 0) {
    await db.insert(skills).values(
      toInsert.map((s) => ({
        ownerId: admin.id,
        scope: "org" as const,
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        defaultActive: false,
      })),
    );
  }
  revalidatePath("/customize");
}
