import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type LegalSlug = "terms" | "privacy" | "eula";

export type LegalDoc = {
  slug: LegalSlug;
  title: string;
  version: string;
  lastUpdated: string;
  body: string;
};

/**
 * Loads a legal document from content/legal/<slug>.md (frontmatter: title,
 * version, lastUpdated). The version must match the corresponding constant in
 * lib/legal/version.ts — enforced by lib/legal/content.test.ts, so a doc edit
 * without a version bump (or vice versa) fails CI. Server-only (fs).
 */
export function getLegalDoc(slug: LegalSlug): LegalDoc {
  const file = path.join(process.cwd(), "content", "legal", `${slug}.md`);
  const { data, content } = matter(fs.readFileSync(file, "utf8"));
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const version = typeof data.version === "string" ? data.version.trim() : "";
  const lastUpdated =
    typeof data.lastUpdated === "string" ? data.lastUpdated.trim() : "";
  if (!title || !version) {
    throw new Error(`content/legal/${slug}.md is missing title/version frontmatter.`);
  }
  return { slug, title, version, lastUpdated, body: content.trim() };
}
