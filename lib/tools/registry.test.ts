import { describe, expect, it, vi } from "vitest";
import {
  ToolRegistry,
  schemaRequired,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "@/lib/tools/registry";

const CTX: ToolContext = { userId: "u1", conversationId: "c1" };

function makeTool(id: string, overrides: Partial<Tool> = {}): Tool {
  const required = (overrides.definition?.input_schema as { required?: string[] } | undefined)
    ?.required ?? [];
  return {
    descriptor: {
      id,
      title: id,
      description: `desc ${id}`,
      kind: "read",
      permissions: ["safe"],
      capabilities: [],
      intentKeywords: [],
      supportedFileTypes: [],
      requiredInputs: required,
      fenceOutput: false,
      ...overrides.descriptor,
    },
    definition: overrides.definition ?? {
      name: id,
      description: `desc ${id}`,
      input_schema: { type: "object", properties: {}, required: [] },
    },
    run: overrides.run ?? (async () => ({ output: "{}", summary: "ok", status: "ok" })),
    describe: overrides.describe,
  };
}

describe("ToolRegistry.register", () => {
  it("registers and retrieves a tool", () => {
    const r = new ToolRegistry();
    const t = makeTool("alpha");
    r.register(t);
    expect(r.get("alpha")).toBe(t);
    expect(r.list()).toHaveLength(1);
  });

  it("rejects duplicate ids", () => {
    const r = new ToolRegistry();
    r.register(makeTool("dup"));
    expect(() => r.register(makeTool("dup"))).toThrow(/already registered/);
  });

  it("rejects id that does not equal definition.name", () => {
    const r = new ToolRegistry();
    const t = makeTool("x");
    t.descriptor.id = "mismatch";
    expect(() => r.register(t)).toThrow(/must equal definition.name/);
  });

  it("rejects requiredInputs that disagree with input_schema.required", () => {
    const r = new ToolRegistry();
    const t = makeTool("y", {
      definition: {
        name: "y",
        description: "d",
        input_schema: { type: "object", properties: { a: {} }, required: ["a"] },
      },
    });
    t.descriptor.requiredInputs = []; // drift from schema.required ["a"]
    expect(() => r.register(t)).toThrow(/requiredInputs must match/);
  });
});

describe("ToolRegistry.definitions", () => {
  it("returns the exact definition objects (API contract unchanged)", () => {
    const r = new ToolRegistry();
    const t = makeTool("alpha");
    r.register(t);
    expect(r.definitions(r.list())).toEqual([t.definition]);
    expect(r.definitions(r.list())[0]).toBe(t.definition);
  });
});

describe("ToolRegistry.available", () => {
  it("excludes tools whose gate returns false and respects toolNames", async () => {
    const r = new ToolRegistry();
    r.register(makeTool("always"));
    r.register(makeTool("gatedOff", { descriptor: { isAvailable: () => false } as never }));
    r.register(makeTool("gatedOn", { descriptor: { isAvailable: async () => true } as never }));

    const ids = (await r.available(CTX)).map((t) => t.descriptor.id);
    expect(ids).toContain("always");
    expect(ids).toContain("gatedOn");
    expect(ids).not.toContain("gatedOff");

    const restricted = await r.available({ ...CTX, toolNames: ["always"] });
    expect(restricted.map((t) => t.descriptor.id)).toEqual(["always"]);
  });
});

describe("ToolRegistry.findByIntent", () => {
  it("ranks a matching tool above unrelated ones by keyword + attachment", () => {
    const r = new ToolRegistry();
    r.register(
      makeTool("takeoff", {
        descriptor: {
          intentKeywords: ["material takeoff", "how many"],
          supportedFileTypes: ["application/pdf"],
        } as never,
      }),
    );
    r.register(makeTool("unrelated", { descriptor: { intentKeywords: ["weather"] } as never }));

    const ranked = r.findByIntent("make a material takeoff of the doors", [
      { mime: "application/pdf", name: "plans.pdf", dataBase64: "" },
    ]);
    expect(ranked[0].descriptor.id).toBe("takeoff");
    expect(ranked.map((t) => t.descriptor.id)).not.toContain("unrelated");
  });
});

describe("ToolRegistry.execute", () => {
  it("returns an error result for an unknown tool (never throws)", async () => {
    const r = new ToolRegistry();
    const res = await r.execute(CTX, "nope", {});
    expect(res.isError).toBe(true);
    expect(res.status).toBe("error");
    expect(res.output).toContain("Unknown tool");
  });

  it("validates required inputs before running", async () => {
    const r = new ToolRegistry();
    const run = vi.fn(async (): Promise<ToolResult> => ({ output: "{}", summary: "ok", status: "ok" }));
    r.register(
      makeTool("needsA", {
        definition: {
          name: "needsA",
          description: "d",
          input_schema: { type: "object", properties: { a: {} }, required: ["a"] },
        },
        run,
      }),
    );
    const res = await r.execute(CTX, "needsA", {});
    expect(res.isError).toBe(true);
    expect(res.output).toContain("Missing required input");
    expect(run).not.toHaveBeenCalled();
  });

  it("never throws when run() throws, and stamps durationMs", async () => {
    const r = new ToolRegistry();
    r.register(
      makeTool("boom", {
        run: async () => {
          throw new Error("kaboom");
        },
      }),
    );
    const res = await r.execute(CTX, "boom", {});
    expect(res.isError).toBe(true);
    expect(res.status).toBe("error");
    expect(res.summary).toBe("boom failed");
    expect(typeof res.durationMs).toBe("number");
  });

  it("passes through a successful result and stamps durationMs", async () => {
    const r = new ToolRegistry();
    r.register(
      makeTool("good", {
        run: async () => ({ output: '{"ok":true}', summary: "done", status: "ok" }),
      }),
    );
    const res = await r.execute(CTX, "good", {});
    expect(res.isError).toBeUndefined();
    expect(res.output).toBe('{"ok":true}');
    expect(typeof res.durationMs).toBe("number");
  });
});

describe("schemaRequired", () => {
  it("extracts the required array from a JSON input schema", () => {
    expect(
      schemaRequired({
        name: "t",
        description: "d",
        input_schema: { type: "object", properties: {}, required: ["a", "b"] },
      }),
    ).toEqual(["a", "b"]);
    expect(
      schemaRequired({ name: "t", description: "d", input_schema: { type: "object" } }),
    ).toEqual([]);
  });
});
