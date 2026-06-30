import matter from "gray-matter";

export type ParsedSkillMd = {
  name: string;
  description?: string;
  instructions: string;
};

/** Parses a SKILL.md file: YAML frontmatter (name, description, ...) + a
 * markdown body that becomes the skill's instructions. Unknown frontmatter
 * fields (e.g. from Anthropic's broader Skill spec) are ignored — this app's
 * skill model is text-instructions-only. */
export function parseSkillMd(raw: string): ParsedSkillMd {
  const { data, content } = matter(raw);
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) {
    throw new Error("SKILL.md must have a \"name\" field in its frontmatter.");
  }
  const description =
    typeof data.description === "string" ? data.description.trim() : undefined;
  const instructions = content.trim();
  if (!instructions) {
    throw new Error("SKILL.md has no instructions body.");
  }
  return { name, description, instructions };
}
