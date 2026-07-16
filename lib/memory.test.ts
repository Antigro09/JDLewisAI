import { describe, expect, it } from "vitest";
import { buildMemoryPrompt } from "@/lib/memory";
import type { Memory, MemoryCategory } from "@/lib/db/schema";

function mem(content: string, category: MemoryCategory = "standard"): Memory {
  return {
    id: Math.random().toString(36).slice(2),
    ownerId: "u1",
    scope: "org",
    category,
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Memory;
}

describe("buildMemoryPrompt", () => {
  it("returns empty string when there are no memories", () => {
    expect(buildMemoryPrompt([])).toBe("");
  });

  it("groups memories by category label", () => {
    const out = buildMemoryPrompt([
      mem("slabs at 4000 psi", "standard"),
      mem("prefer Acme rebar", "vendor"),
    ]);
    expect(out).toContain("Company standard:");
    expect(out).toContain("- slabs at 4000 psi");
    expect(out).toContain("Preferred sub / vendor:");
  });

  it("never cuts an individual memory mid-sentence when over budget", () => {
    // ~200 memories of ~100 chars = ~20k chars, over the 12k budget.
    const long = Array.from({ length: 200 }, (_, i) =>
      mem(`Lesson ${i}: never substitute brand X fasteners unless the engineer approves in writing`, "lesson"),
    );
    const out = buildMemoryPrompt(long);
    expect(out.length).toBeLessThanOrEqual(12_000 + 100);
    // Every emitted memory line is whole — no line ends mid-"unless…in writing".
    for (const line of out.split("\n").filter((l) => l.startsWith("- Lesson"))) {
      expect(line.endsWith("in writing")).toBe(true);
    }
    // And the omission is disclosed rather than silent.
    expect(out).toMatch(/more memor(y|ies) omitted/);
  });

  it("keeps everything and adds no omission notice when under budget", () => {
    const out = buildMemoryPrompt([mem("a"), mem("b")]);
    expect(out).not.toMatch(/omitted/);
  });
});
