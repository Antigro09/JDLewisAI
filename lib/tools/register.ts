import { GOOGLE_TOOLS, runGoogleTool, type GoogleTool } from "@/lib/tools/google-tools";
import { LOCAL_TOOLS, runLocalTool, type LocalTool } from "@/lib/tools/local-tools";
import {
  GOOGLE_TOOL_DESCRIPTORS,
  LOCAL_TOOL_DESCRIPTORS,
  type PartialDescriptor,
} from "@/lib/tools/descriptors";
import {
  schemaRequired,
  toolRegistry,
  type Tool,
  type ToolDefinition,
  type ToolResult,
} from "@/lib/tools/registry";
import {
  getTakeoffResultsTool,
  materialTakeoffTool,
} from "@/lib/tools/engines/material-takeoff-tool";

/**
 * The single place tools plug into the registry (Phase 16). Importing this
 * module for its side effects registers every tool. To add an engine: author a
 * Tool and add one `safeRegister(...)` line — nothing in the chat UI, agent
 * loop, or system prompt changes.
 */

type LegacyResult = { output: string; summary: string; link?: string; isError?: boolean };

/** Legacy LocalToolResult / GoogleToolResult → standardized ToolResult. */
function toToolResult(r: LegacyResult): ToolResult {
  return {
    output: r.output,
    summary: r.summary,
    link: r.link,
    status: r.isError ? "error" : "ok",
    isError: r.isError,
  };
}

/** Build a full descriptor, deriving requiredInputs from the schema so it can
 * never drift from input_schema.required. */
function fullDescriptor(base: PartialDescriptor, definition: ToolDefinition) {
  return { ...base, requiredInputs: schemaRequired(definition) };
}

function fromLocalTool(tool: LocalTool): Tool {
  const base = LOCAL_TOOL_DESCRIPTORS[tool.name];
  if (!base) throw new Error(`Missing descriptor for local tool "${tool.name}".`);
  return {
    descriptor: fullDescriptor(base, tool.definition),
    definition: tool.definition,
    run: async (ctx, input) => toToolResult(await runLocalTool(ctx.userId, tool.name, input)),
  };
}

function fromGoogleTool(tool: GoogleTool): Tool {
  const base = GOOGLE_TOOL_DESCRIPTORS[tool.name];
  if (!base) throw new Error(`Missing descriptor for google tool "${tool.name}".`);
  return {
    descriptor: fullDescriptor(base, tool.definition),
    definition: tool.definition,
    describe: tool.describe,
    run: async (ctx, input) =>
      toToolResult(await runGoogleTool(ctx.userId, tool.name, input, ctx.execContext)),
  };
}

/** Idempotent — tolerates re-import (dev HMR) without a duplicate-id throw. */
function safeRegister(tool: Tool): void {
  if (!toolRegistry.get(tool.descriptor.id)) toolRegistry.register(tool);
}

for (const t of LOCAL_TOOLS) safeRegister(fromLocalTool(t));
for (const t of GOOGLE_TOOLS) safeRegister(fromGoogleTool(t));
safeRegister(materialTakeoffTool);
safeRegister(getTakeoffResultsTool);
