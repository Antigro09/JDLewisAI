import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@/lib/claude/types";
import type { ToolContext } from "@/lib/tools/registry";

// In-memory takeoff_projects store driving the fake db.
const store: { rows: Record<string, unknown>[] } = { rows: [] };

vi.mock("@/lib/env", () => ({ env: { TAKEOFF_ENGINE_URL: "http://localhost:8000" } }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => (store.rows.length ? [store.rows[store.rows.length - 1]] : []),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `t-${store.rows.length + 1}`, createdAt: new Date(), ...v };
          store.rows.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (store.rows.length) Object.assign(store.rows[store.rows.length - 1], patch);
        },
      }),
    }),
  },
}));

vi.mock("@/lib/plugins", () => ({
  effectivePlugins: vi.fn(async () => ({ material_takeoff: true })),
}));

// Partial mock: override the network functions but keep the REAL Engine*Error
// classes so `instanceof` checks in the tool still work.
vi.mock("@/lib/takeoff-engine/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/takeoff-engine/client")>();
  return {
    ...actual,
    createProject: vi.fn(),
    uploadFile: vi.fn(),
    indexProject: vi.fn(),
    listSheets: vi.fn(),
    startScopedProcess: vi.fn(),
    getJob: vi.fn(),
  };
});

vi.mock("@/lib/takeoff-engine/bridge", () => ({ buildBridgedTakeoffReport: vi.fn() }));

import {
  createProject,
  EngineDownError,
  getJob,
  indexProject,
  listSheets,
  startScopedProcess,
  uploadFile,
} from "@/lib/takeoff-engine/client";
import { buildBridgedTakeoffReport } from "@/lib/takeoff-engine/bridge";
import { getTakeoffResultsTool, materialTakeoffTool } from "./material-takeoff-tool";

const PDF: Attachment = {
  mime: "application/pdf",
  name: "plans.pdf",
  dataBase64: Buffer.from("%PDF-1.4 test").toString("base64"),
};

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { userId: "u1", conversationId: "c1", ...overrides };
}

beforeEach(() => {
  store.rows = [];
  vi.clearAllMocks();
});

describe("material_takeoff", () => {
  it("runs the full pipeline and hands off a review link with NO quantities", async () => {
    vi.mocked(createProject).mockResolvedValue({ id: "eng-1", name: "x", status: "created" });
    vi.mocked(uploadFile).mockResolvedValue({ id: "f1", storage_path: "p", media_type: "application/pdf" });
    vi.mocked(indexProject).mockResolvedValue({ job_id: "j-idx", status: "queued" });
    vi.mocked(getJob).mockResolvedValue({
      id: "j-idx", project_id: "eng-1", kind: "index", status: "done",
    });
    vi.mocked(listSheets).mockResolvedValue([
      { id: "s1", page_number: 1 },
      { id: "s2", page_number: 2 },
      { id: "s3", page_number: 3 },
    ]);
    vi.mocked(startScopedProcess).mockResolvedValue({ job_id: "j-proc", status: "queued" });

    const res = await materialTakeoffTool.run(ctx({ attachments: [PDF] }), {
      scope: "doors, west wing",
    });

    // Drove the engine end-to-end.
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(indexProject).toHaveBeenCalledTimes(1);
    expect(startScopedProcess).toHaveBeenCalledTimes(1);

    // Handed off, did not block to completion.
    expect(res.status).toBe("in_progress");
    expect(res.link).toBe("/material-takeoff?t=t-1");
    expect(res.isError).toBeFalsy();

    // Linked to the conversation for follow-ups.
    expect(store.rows[0].conversationId).toBe("c1");

    // Determinism guard: the tool returns a job handle, never quantities.
    const out = JSON.parse(res.output);
    expect(out.takeoffId).toBe("t-1");
    expect(out.status).toBe("processing");
    expect(out).not.toHaveProperty("totals");
    expect(out).not.toHaveProperty("quantities");
    expect(out).not.toHaveProperty("doors");
    expect(out.note).toContain("get_takeoff_results");
  });

  it("asks for drawings when nothing is attached and none is linked", async () => {
    const res = await materialTakeoffTool.run(ctx(), {});
    expect(res.isError).toBe(true);
    expect(createProject).not.toHaveBeenCalled();
    expect(JSON.parse(res.output).error).toBe("no_drawings");
  });

  it("surfaces engine-down as an error and forbids fabricated counts", async () => {
    vi.mocked(createProject).mockRejectedValue(new EngineDownError());
    const res = await materialTakeoffTool.run(ctx({ attachments: [PDF] }), {});
    expect(res.isError).toBe(true);
    expect(res.status).toBe("error");
    expect(res.summary).toBe("Takeoff engine unavailable");
    const out = JSON.parse(res.output);
    expect(out.error).toBe("engine_unavailable");
    expect(out.note.toLowerCase()).toContain("do not");
  });
});

describe("get_takeoff_results", () => {
  it("returns engine totals (unchanged) once the takeoff is in review", async () => {
    store.rows = [
      {
        id: "t-9", userId: "u1", conversationId: "c1", engineProjectId: "eng-9",
        status: "review", engineJobId: "j-proc", createdAt: new Date(),
      },
    ];
    vi.mocked(getJob).mockResolvedValue({
      id: "j-proc", project_id: "eng-9", kind: "process", status: "done",
    });
    vi.mocked(buildBridgedTakeoffReport).mockResolvedValue({
      includedQuantityIds: ["q1"],
      report: {
        generatedAt: "", scope: {}, sheets: [], divisions: [], issues: [], usage: [],
        measurements: [
          {
            kind: "count", quantity: 42, unit: "EA", trade: "doors_windows",
            label: "Door", sheetRef: "A1 p.1", basis: "engine", source: "traced", assumptions: [],
          },
        ],
      },
    });

    const res = await getTakeoffResultsTool.run(ctx(), {});
    expect(res.status).toBe("needs_review");
    const out = JSON.parse(res.output);
    // The 42 comes straight from the engine bridge — passed through, not invented.
    expect(out.totals.doors_windows.EA).toBe(42);
    expect(out.itemCount).toBe(1);
  });

  it("reports status without any numbers while still processing", async () => {
    store.rows = [
      {
        id: "t-3", userId: "u1", conversationId: "c1", engineProjectId: "eng-3",
        status: "processing", engineJobId: "j", createdAt: new Date(),
      },
    ];
    vi.mocked(getJob).mockResolvedValue({
      id: "j", project_id: "eng-3", kind: "process", status: "running",
    });

    const res = await getTakeoffResultsTool.run(ctx(), {});
    expect(res.status).toBe("in_progress");
    expect(buildBridgedTakeoffReport).not.toHaveBeenCalled();
    const out = JSON.parse(res.output);
    expect(out).not.toHaveProperty("totals");
    expect(out.status).toBe("processing");
  });

  it("errors when no takeoff is linked to the conversation", async () => {
    const res = await getTakeoffResultsTool.run(ctx(), {});
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.output).error).toBe("no_takeoff");
  });
});
