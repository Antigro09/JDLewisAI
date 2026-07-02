import { toFile } from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/claude/client";

const SKILLS_BETA = "skills-2025-10-02";

export type UploadableFile = { name: string; mime: string; bytes: Buffer };

/**
 * Upload a skill to the Anthropic Skills API so it can run inside a
 * code-execution container at chat time (`client.beta.skills.create`).
 *
 * The API requires all files to live under one top-level directory that
 * contains a SKILL.md at its root — so every file is prefixed with a sanitized
 * skill-slug directory. Best-effort by design: callers treat a null return as
 * "keep this skill as a local text pack", so a missing key, offline host, or
 * API hiccup never blocks skill creation.
 */
export async function createAnthropicSkill(opts: {
  displayTitle: string;
  skillMd: string;
  referenceFiles: UploadableFile[];
}): Promise<{ id: string; version: string | null } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const slug =
    opts.displayTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "skill";

  try {
    const files = [
      await toFile(Buffer.from(opts.skillMd, "utf8"), `${slug}/SKILL.md`, {
        type: "text/markdown",
      }),
      ...(await Promise.all(
        opts.referenceFiles.map((f) =>
          toFile(f.bytes, `${slug}/${f.name}`, {
            type: f.mime || "application/octet-stream",
          }),
        ),
      )),
    ];

    const created = await (
      anthropic().beta as unknown as {
        skills: {
          create: (
            body: unknown,
          ) => Promise<{ id: string; latest_version?: string | null }>;
        };
      }
    ).skills.create({
      display_title: opts.displayTitle,
      files,
      betas: [SKILLS_BETA],
    });

    return { id: created.id, version: created.latest_version ?? null };
  } catch {
    // Non-fatal: the skill still works as a text-injection pack.
    return null;
  }
}
