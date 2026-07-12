import type { ToolDescriptor } from "@/lib/tools/registry";
import { GOOGLE_TOOLS } from "@/lib/tools/google-tools";
import { LOCAL_TOOLS } from "@/lib/tools/local-tools";

/**
 * Descriptor metadata for the two pre-existing tool families. Kept here so
 * lib/tools/local-tools.ts and google-tools.ts stay diff-free — register.ts
 * fills `requiredInputs` from each tool's input_schema, so these entries omit
 * it (and can never drift out of sync with the schema).
 */
export type PartialDescriptor = Omit<ToolDescriptor, "requiredInputs">;

const LOCAL_INTENT: Record<string, string[]> = {
  calculate_concrete: ["concrete", "cubic yards", "slab volume", "footing", "pour", "cy"],
  calculate_rebar: ["rebar", "reinforcing steel", "bar weight", "reinforcement"],
  calculate_pipe_volume: ["pipe volume", "pipe capacity", "gallons", "fill volume"],
  calculate_voltage_drop: ["voltage drop", "conductor size", "wire size", "awg", "vd"],
  calculate_hvac_load: ["hvac load", "tonnage", "cooling load", "btu", "air conditioning sizing"],
  save_memory: ["remember this", "save to memory", "note this", "keep in mind"],
};

/** Local calculators + save_memory: pure compute, always available, safe. */
export const LOCAL_TOOL_DESCRIPTORS: Record<string, PartialDescriptor> = Object.fromEntries(
  LOCAL_TOOLS.map((t): [string, PartialDescriptor] => [
    t.name,
    {
      id: t.name,
      title: t.name,
      description: t.definition.description,
      kind: "read",
      permissions: ["safe"],
      capabilities: t.name === "save_memory" ? ["memory"] : ["calculation"],
      intentKeywords: LOCAL_INTENT[t.name] ?? [],
      supportedFileTypes: [],
      fenceOutput: false,
    },
  ]),
);

const GOOGLE_INTENT: Record<string, string[]> = {
  drive_search: ["find in drive", "search drive", "google drive file"],
  drive_read_file: ["read drive file", "open drive doc"],
  sheets_read: ["read spreadsheet", "read google sheet"],
  sheets_create: ["create spreadsheet", "new google sheet", "make a sheet"],
  sheets_append_rows: ["append to sheet", "add rows to spreadsheet"],
  docs_create: ["create google doc", "new document", "write a doc"],
  docs_append_text: ["append to doc", "add text to document"],
  docs_replace_text: ["edit google doc", "replace text in doc"],
  gmail_search: ["search email", "find email", "search gmail"],
  gmail_read_message: ["read email", "open email"],
  gmail_create_draft: ["draft email", "create email draft"],
  gmail_send: ["send email", "email this"],
};

/**
 * Google Workspace descriptors, derived from GOOGLE_TOOLS so kind (read/write)
 * always matches the tool. Gated on the Google plugin being on for the turn.
 */
export const GOOGLE_TOOL_DESCRIPTORS: Record<string, PartialDescriptor> = Object.fromEntries(
  GOOGLE_TOOLS.map((t): [string, PartialDescriptor] => [
    t.name,
    {
      id: t.name,
      title: t.name,
      description: t.definition.description,
      kind: t.kind,
      permissions: ["cloud", "internet"],
      capabilities: ["google_workspace"],
      intentKeywords: GOOGLE_INTENT[t.name] ?? [],
      supportedFileTypes: [],
      fenceOutput: true,
      isAvailable: (ctx) => Boolean(ctx.googleEnabled),
    },
  ]),
);
