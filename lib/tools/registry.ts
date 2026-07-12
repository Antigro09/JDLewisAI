import type { Attachment } from "@/lib/claude/types";
import type { ToolExecutionContext } from "@/lib/tools/google-tools";

/**
 * Unified tool registry — the single thing the chat agent knows about. Native
 * Anthropic tool-use is the router: the model reads each tool's descriptor and
 * decides which to call. This module only unifies the tool shapes, standardizes
 * results, and provides a deterministic *gate* (which tools are even attached
 * to a given turn). It never makes the routing decision itself.
 *
 * Tools plug in via `toolRegistry.register(...)` in lib/tools/register.ts — no
 * other file needs to change to add an engine.
 */

export type ToolKind = "read" | "write";

/** Coarse capability/cost flags. Router/UI can surface these; `write` still
 * drives the confirmation gate. */
export type ToolPermission =
  | "safe"
  | "expensive"
  | "gpu"
  | "cloud"
  | "internet"
  | "filesystem";

export type ToolResultStatus =
  | "ok"
  | "error"
  | "needs_review"
  | "in_progress"
  | "cancelled";

/** UI-facing artifact — surfaced to the client, never injected into the model
 * context (the model sees only `output`/`summary`). */
export type ToolArtifact = {
  kind: "link" | "report" | "sheet" | "file" | "image";
  label: string;
  url?: string;
  data?: unknown;
};

/**
 * Standardized tool result. Reconciled with the legacy LocalToolResult /
 * MessageBlock.tool_result shape: `output` is model-facing (goes into the API
 * tool_result content) and MUST be tool/engine-sourced — no fabricated numbers
 * ever originate here; `summary`/`link`/`artifacts` are UI-facing.
 */
export type ToolResult = {
  /** Model-facing content (usually JSON). Maps to tool_result content. */
  output: string;
  /** Short human line for the activity strip / confirmation card / audit. */
  summary: string;
  status: ToolResultStatus;
  /** 0..1 engine/tool confidence when available. */
  confidence?: number;
  /** Deep link (review UI, Drive doc, …). */
  link?: string;
  /** UI-only; never sent to the model. */
  artifacts?: ToolArtifact[];
  warnings?: string[];
  /** Structured payload for follow-on tools / conversation-state reuse. */
  data?: Record<string, unknown>;
  isError?: boolean;
  durationMs?: number;
};

export type ToolInput = Record<string, unknown>;

/** Everything a tool may need, threaded from the agent loop. */
export type ToolContext = {
  userId: string;
  conversationId: string;
  /** Attachments on the triggering user turn (base64) — how engine tools get
   * the uploaded PDF bytes. */
  attachments?: Attachment[];
  /** Cancellation — aborts when the client cancels the request. */
  signal?: AbortSignal;
  /** Progress callback → streamed to the client as a tool_activity event. */
  onProgress?: (summary: string) => void;
  /** Google unattended-send guardrails (automation runs). */
  execContext?: ToolExecutionContext;
  /** Whether the Google plugin is on for this turn (gates Google tools). */
  googleEnabled?: boolean;
  /** Restrict which tools (by id) may be attached (automation allowlists). */
  toolNames?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolDescriptor = {
  /** Stable id — must equal `definition.name`. */
  id: string;
  title: string;
  /** Model-facing summary (also seeds `definition.description`). */
  description: string;
  /** read → auto-run; write → pause for user confirmation. */
  kind: ToolKind;
  permissions: ToolPermission[];
  capabilities: string[];
  intentKeywords: string[];
  /** MIME types / extensions the tool consumes (for gating + telemetry). */
  supportedFileTypes: string[];
  /** Mirror of input_schema.required (validated at registration). */
  requiredInputs: string[];
  optionalInputs?: string[];
  /** Ids that should run first (declarative; native tool-use orders them). */
  dependencies?: string[];
  /** Fence output as untrusted external content (Google/MCP/web = true; our
   * own engines + local calculators = false). */
  fenceOutput?: boolean;
  /** Gate: may this tool be attached in this context? Absent = always. */
  isAvailable?: (ctx: ToolContext) => boolean | Promise<boolean>;
};

export type Tool = {
  descriptor: ToolDescriptor;
  definition: ToolDefinition;
  /** Confirmation-card text for write/expensive tools. */
  describe?: (input: ToolInput) => string;
  run: (ctx: ToolContext, input: ToolInput) => Promise<ToolResult>;
};

/** The `required` array from a tool's JSON input schema, as string[]. */
export function schemaRequired(def: ToolDefinition): string[] {
  const req = (def.input_schema as { required?: unknown }).required;
  return Array.isArray(req) ? req.filter((x): x is string => typeof x === "string") : [];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function matchesFileType(a: Attachment, fileType: string): boolean {
  const mime = a.mime.toLowerCase();
  const name = a.name.toLowerCase();
  const f = fileType.toLowerCase();
  if (f.includes("/")) {
    if (f.endsWith("/*")) return mime.startsWith(f.slice(0, -1));
    return mime === f;
  }
  const ext = f.startsWith(".") ? f : `.${f}`;
  return name.endsWith(ext);
}

/** Deterministic intent score — GATING/telemetry only, never the routing call. */
function intentScore(d: ToolDescriptor, text: string, attachments?: Attachment[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of d.intentKeywords) {
    if (kw && lower.includes(kw.toLowerCase())) score += 10;
  }
  if (attachments?.length && d.supportedFileTypes.length) {
    const anyMatch = attachments.some((a) =>
      d.supportedFileTypes.some((ft) => matchesFileType(a, ft)),
    );
    if (anyMatch) score += 20;
  }
  return score;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool. Throws on programmer error (duplicate id, id/name
   * mismatch, or requiredInputs disagreeing with input_schema.required). */
  register(tool: Tool): void {
    const { descriptor, definition } = tool;
    if (descriptor.id !== definition.name) {
      throw new Error(
        `Tool id "${descriptor.id}" must equal definition.name "${definition.name}".`,
      );
    }
    if (this.tools.has(descriptor.id)) {
      throw new Error(`Tool "${descriptor.id}" is already registered.`);
    }
    if (!sameSet(descriptor.requiredInputs, schemaRequired(definition))) {
      throw new Error(
        `Tool "${descriptor.id}": descriptor.requiredInputs must match input_schema.required.`,
      );
    }
    this.tools.set(descriptor.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  find(pred: (t: Tool) => boolean): Tool[] {
    return this.list().filter(pred);
  }

  /** Rank tools by intent — for gating/telemetry, not routing. */
  findByIntent(text: string, attachments?: Attachment[]): Tool[] {
    return this.list()
      .map((t) => ({ tool: t, score: intentScore(t.descriptor, text, attachments) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.tool);
  }

  /** Tools whose gate passes for this context (attached to the model turn). */
  async available(ctx: ToolContext): Promise<Tool[]> {
    const all = this.list();
    const checks = await Promise.all(
      all.map((t) => {
        if (ctx.toolNames && !ctx.toolNames.includes(t.descriptor.id)) return false;
        return t.descriptor.isAvailable ? t.descriptor.isAvailable(ctx) : true;
      }),
    );
    return all.filter((_, i) => checks[i]);
  }

  /** Raw Anthropic tool definitions — the API contract is unchanged. */
  definitions(tools: Tool[]): ToolDefinition[] {
    return tools.map((t) => t.definition);
  }

  /**
   * Validate inputs, time the call, and run the tool. NEVER throws — a thrown
   * `run` (or a missing tool) becomes an error ToolResult so the agent loop can
   * hand it back to the model.
   */
  async execute(ctx: ToolContext, id: string, input: ToolInput): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.get(id);
    if (!tool) {
      return { output: `Unknown tool: ${id}`, summary: "Unknown tool", status: "error", isError: true };
    }
    const missing = tool.descriptor.requiredInputs.filter(
      (k) => input[k] === undefined || input[k] === null || input[k] === "",
    );
    if (missing.length) {
      return {
        output: `Missing required input(s): ${missing.join(", ")}`,
        summary: `${id}: missing ${missing.join(", ")}`,
        status: "error",
        isError: true,
        durationMs: Date.now() - started,
      };
    }
    try {
      const r = await tool.run(ctx, input);
      return { ...r, durationMs: r.durationMs ?? Date.now() - started };
    } catch (err) {
      return {
        output: `Error running ${id}: ${err instanceof Error ? err.message : "unknown"}`,
        summary: `${id} failed`,
        status: "error",
        isError: true,
        durationMs: Date.now() - started,
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();
