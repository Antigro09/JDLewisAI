import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories, type Memory, type MemoryCategory, type AppUser } from "@/lib/db/schema";

export const MEMORY_CATEGORIES: { id: MemoryCategory; label: string }[] = [
  { id: "standard", label: "Company standard" },
  { id: "preference", label: "Preference" },
  { id: "vendor", label: "Preferred sub / vendor" },
  { id: "material", label: "Preferred material" },
  { id: "method", label: "Estimating / method" },
  { id: "lesson", label: "Lesson learned" },
  { id: "project", label: "Project history" },
  { id: "other", label: "Other" },
];

/** Memories a user can see: their personal memories + all org-wide memories. */
export async function listMemories(user: AppUser): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(or(eq(memories.ownerId, user.id), eq(memories.scope, "org")))
    .orderBy(desc(memories.updatedAt));
}

export async function createMemory(opts: {
  ownerId: string;
  scope: "personal" | "org";
  category: MemoryCategory;
  content: string;
}): Promise<void> {
  await db.insert(memories).values({
    ownerId: opts.ownerId,
    scope: opts.scope,
    category: opts.category,
    content: opts.content,
  });
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.ownerId, userId)));
}

/** Compact memory block folded into the system prompt (budget-capped). */
export function buildMemoryPrompt(rows: Memory[]): string {
  if (!rows.length) return "";
  const byCat = new Map<string, string[]>();
  for (const m of rows) {
    const label =
      MEMORY_CATEGORIES.find((c) => c.id === m.category)?.label ?? "Other";
    if (!byCat.has(label)) byCat.set(label, []);
    byCat.get(label)!.push(m.content);
  }
  const header =
    "Remembered context — durable facts about this company/user. Apply them unless the " +
    "user says otherwise:\n\n";
  const BUDGET = 12_000;

  // Drop whole memories (never cut one mid-sentence — that can silently turn a
  // conditional rule like "never substitute X unless the engineer approves"
  // into an absolute one). Fill category blocks item-by-item until the budget
  // is spent.
  const blocks: string[] = [];
  let used = header.length;
  let dropped = 0;
  for (const [label, items] of byCat) {
    const kept: string[] = [];
    for (const item of items) {
      const line = `- ${item}`;
      const cost = (kept.length === 0 ? label.length + 1 : 0) + line.length + 1;
      if (used + cost > BUDGET) {
        dropped++;
        continue;
      }
      used += cost;
      kept.push(line);
    }
    if (kept.length) blocks.push(`${label}:\n${kept.join("\n")}`);
  }
  let text = header + blocks.join("\n\n");
  if (dropped > 0) text += `\n\n…[${dropped} more memor${dropped === 1 ? "y" : "ies"} omitted for length]`;
  return text;
}
