import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@/lib/claude/types";
import type { ToolContext } from "@/lib/tools/registry";

// register.ts pulls in the takeoff engine tool → db/env/plugins. Stub them so
// this exercises the REAL registration + gating wiring without a DB/engine.
vi.mock("@/lib/env", () => ({ env: { TAKEOFF_ENGINE_URL: "http://localhost:8000" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
    }),
  },
}));
vi.mock("@/lib/plugins", () => ({
  effectivePlugins: vi.fn(async () => ({ material_takeoff: true, google: true })),
}));
vi.mock("@/lib/memory", () => ({
  MEMORY_CATEGORIES: [{ id: "other", label: "Other" }],
  createMemory: vi.fn(async () => {}),
}));

import { toolRegistry } from "@/lib/tools/registry";
import "@/lib/tools/register";

const PDF: Attachment = { mime: "application/pdf", name: "a.pdf", dataBase64: "" };

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { userId: "u1", conversationId: "c1", ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("tool registration (production wiring)", () => {
  it("registers local calculators, Google tools, and the engine tools", () => {
    expect(toolRegistry.get("calculate_concrete")).toBeDefined();
    expect(toolRegistry.get("drive_search")).toBeDefined();
    expect(toolRegistry.get("material_takeoff")).toBeDefined();
    expect(toolRegistry.get("get_takeoff_results")).toBeDefined();
  });

  it("derives requiredInputs from each tool's input_schema (no drift)", () => {
    // calculate_concrete requires lengthFt/widthFt/thicknessIn in its schema.
    expect(toolRegistry.get("calculate_concrete")!.descriptor.requiredInputs.sort()).toEqual(
      ["lengthFt", "thicknessIn", "widthFt"],
    );
  });
});

describe("gating via available()", () => {
  it("offers material_takeoff when a PDF is attached, not otherwise", async () => {
    const withPdf = (await toolRegistry.available(ctx({ attachments: [PDF] }))).map(
      (t) => t.descriptor.id,
    );
    expect(withPdf).toContain("material_takeoff");
    expect(withPdf).toContain("calculate_concrete");

    const noPdf = (await toolRegistry.available(ctx())).map((t) => t.descriptor.id);
    expect(noPdf).not.toContain("material_takeoff"); // no attachment, no linked takeoff
    expect(noPdf).toContain("calculate_concrete"); // always available
  });

  it("gates Google tools on the googleEnabled flag", async () => {
    const off = (await toolRegistry.available(ctx({ googleEnabled: false }))).map(
      (t) => t.descriptor.id,
    );
    expect(off).not.toContain("drive_search");

    const on = (await toolRegistry.available(ctx({ googleEnabled: true }))).map(
      (t) => t.descriptor.id,
    );
    expect(on).toContain("drive_search");
  });
});
