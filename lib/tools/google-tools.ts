import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { automations } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { getValidAccessToken, GoogleNotConnectedError } from "@/lib/google/client";
import { driveSearch, driveReadFile } from "@/lib/google/drive";
import { docsCreate, docsAppendText, docsReplaceText } from "@/lib/google/docs";
import { sheetsCreate, sheetsAppendRows, sheetsRead } from "@/lib/google/sheets";
import {
  gmailSearch,
  gmailReadMessage,
  gmailSend,
  gmailCreateDraft,
} from "@/lib/google/gmail";

export type GoogleToolKind = "read" | "write";

/** Execution context threaded from the caller (lib/automations/run.ts →
 * runAgentTurn → here). Unattended runs carry the automation's send
 * guardrails, which are enforced in code — no prompt can override them. */
export type ToolExecutionContext = {
  /** True when no human is in the loop (automation runs). */
  unattended: boolean;
  automation?: {
    id: string;
    /** "a@b.com" (exact) or "@b.com" (domain); null/empty = no unattended sends. */
    sendAllowlist: string[] | null;
    maxSendsPerDay: number;
  };
};

export type GoogleToolResult = {
  output: string; // model-facing (usually JSON)
  summary: string; // short line for the UI
  link?: string;
  isError?: boolean;
};

type Input = Record<string, unknown>;

export type GoogleTool = {
  name: string;
  kind: GoogleToolKind;
  definition: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  describe: (input: Input) => string; // pending-confirmation summary
  exec: (token: string, input: Input) => Promise<GoogleToolResult>;
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

function toRows(v: unknown): (string | number)[][] {
  if (!Array.isArray(v)) return [];
  return v.map((row) =>
    Array.isArray(row)
      ? row.map((c) => (typeof c === "number" ? c : String(c ?? "")))
      : [String(row ?? "")],
  );
}

export const GOOGLE_TOOLS: GoogleTool[] = [
  {
    name: "drive_search",
    kind: "read",
    definition: {
      name: "drive_search",
      description:
        "Search the user's Google Drive for files by name or full-text content. Returns matching files with their IDs and links.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms" },
          max: { type: "integer", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    describe: (i) => `Search Drive for "${str(i.query)}"`,
    exec: async (token, i) => {
      const files = await driveSearch(token, str(i.query), num(i.max, 10));
      return {
        output: JSON.stringify(files),
        summary: `Found ${files.length} Drive file(s) for "${str(i.query)}"`,
      };
    },
  },
  {
    name: "drive_read_file",
    kind: "read",
    definition: {
      name: "drive_read_file",
      description:
        "Read the text content of a Google Drive file by ID (Docs export as text, Sheets as CSV, text files as-is).",
      input_schema: {
        type: "object",
        properties: { fileId: { type: "string" } },
        required: ["fileId"],
      },
    },
    describe: (i) => `Read Drive file ${str(i.fileId)}`,
    exec: async (token, i) => {
      const f = await driveReadFile(token, str(i.fileId));
      return {
        output: JSON.stringify(f),
        summary: `Read "${f.name}"`,
      };
    },
  },
  {
    name: "sheets_read",
    kind: "read",
    definition: {
      name: "sheets_read",
      description: "Read values from a Google Sheet by spreadsheet ID and optional A1 range.",
      input_schema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string", description: "A1 range, e.g. Sheet1!A1:D20" },
        },
        required: ["spreadsheetId"],
      },
    },
    describe: (i) => `Read sheet ${str(i.spreadsheetId)}`,
    exec: async (token, i) => {
      const values = await sheetsRead(
        token,
        str(i.spreadsheetId),
        str(i.range, "Sheet1"),
      );
      return {
        output: JSON.stringify(values),
        summary: `Read ${values.length} row(s) from the sheet`,
      };
    },
  },
  {
    name: "gmail_search",
    kind: "read",
    definition: {
      name: "gmail_search",
      description:
        "Search the user's Gmail using Gmail query syntax (e.g. 'from:alice subject:invoice newer_than:7d'). Returns message summaries with IDs.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          max: { type: "integer", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    describe: (i) => `Search Gmail for "${str(i.query)}"`,
    exec: async (token, i) => {
      const msgs = await gmailSearch(token, str(i.query), num(i.max, 10));
      return {
        output: JSON.stringify(msgs),
        summary: `Found ${msgs.length} email(s)`,
      };
    },
  },
  {
    name: "gmail_read_message",
    kind: "read",
    definition: {
      name: "gmail_read_message",
      description: "Read the full content of a Gmail message by ID.",
      input_schema: {
        type: "object",
        properties: { messageId: { type: "string" } },
        required: ["messageId"],
      },
    },
    describe: (i) => `Read email ${str(i.messageId)}`,
    exec: async (token, i) => {
      const m = await gmailReadMessage(token, str(i.messageId));
      return {
        output: JSON.stringify(m),
        summary: `Read email: "${m.subject}"`,
      };
    },
  },
  // ---- write tools (require confirmation) ----
  {
    name: "docs_create",
    kind: "write",
    definition: {
      name: "docs_create",
      description:
        "Create a new Google Doc in the user's Drive with a title and optional initial content.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string", description: "Initial document text" },
        },
        required: ["title"],
      },
    },
    describe: (i) => `Create a Google Doc titled "${str(i.title)}"`,
    exec: async (token, i) => {
      const r = await docsCreate(token, str(i.title), str(i.content));
      return {
        output: JSON.stringify(r),
        summary: `Created Doc "${str(i.title)}"`,
        link: r.link,
      };
    },
  },
  {
    name: "docs_append_text",
    kind: "write",
    definition: {
      name: "docs_append_text",
      description: "Append text to the end of an existing Google Doc by document ID.",
      input_schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          text: { type: "string" },
        },
        required: ["documentId", "text"],
      },
    },
    describe: (i) => `Append text to Doc ${str(i.documentId)}`,
    exec: async (token, i) => {
      const r = await docsAppendText(token, str(i.documentId), str(i.text));
      return { output: JSON.stringify(r), summary: "Appended text to the Doc", link: r.link };
    },
  },
  {
    name: "docs_replace_text",
    kind: "write",
    definition: {
      name: "docs_replace_text",
      description:
        "Find and replace all occurrences of text in an existing Google Doc by document ID.",
      input_schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          find: { type: "string" },
          replace: { type: "string" },
        },
        required: ["documentId", "find", "replace"],
      },
    },
    describe: (i) => `Replace "${str(i.find)}" in Doc ${str(i.documentId)}`,
    exec: async (token, i) => {
      const r = await docsReplaceText(
        token,
        str(i.documentId),
        str(i.find),
        str(i.replace),
      );
      return {
        output: JSON.stringify(r),
        summary: `Replaced ${r.replacements} occurrence(s)`,
        link: r.link,
      };
    },
  },
  {
    name: "sheets_create",
    kind: "write",
    definition: {
      name: "sheets_create",
      description:
        "Create a new Google Sheet with a title and optional initial rows (array of row arrays).",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          rows: {
            type: "array",
            description: "Array of rows; each row is an array of cell values",
            items: { type: "array", items: {} },
          },
        },
        required: ["title"],
      },
    },
    describe: (i) => `Create a Google Sheet titled "${str(i.title)}"`,
    exec: async (token, i) => {
      const r = await sheetsCreate(token, str(i.title), toRows(i.rows));
      return {
        output: JSON.stringify(r),
        summary: `Created Sheet "${str(i.title)}"`,
        link: r.link,
      };
    },
  },
  {
    name: "sheets_append_rows",
    kind: "write",
    definition: {
      name: "sheets_append_rows",
      description:
        "Append rows to an existing Google Sheet by spreadsheet ID. rows is an array of row arrays.",
      input_schema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          rows: { type: "array", items: { type: "array", items: {} } },
          range: { type: "string", description: "Target sheet/range (default Sheet1)" },
        },
        required: ["spreadsheetId", "rows"],
      },
    },
    describe: (i) => `Append rows to sheet ${str(i.spreadsheetId)}`,
    exec: async (token, i) => {
      const r = await sheetsAppendRows(
        token,
        str(i.spreadsheetId),
        toRows(i.rows),
        str(i.range, "Sheet1"),
      );
      return {
        output: JSON.stringify(r),
        summary: `Appended ${r.updatedRows} row(s)`,
        link: r.link,
      };
    },
  },
  {
    name: "gmail_create_draft",
    kind: "write",
    definition: {
      name: "gmail_create_draft",
      description:
        "Create a draft email in the user's Gmail (does NOT send it — a human sends later).",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          cc: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
    describe: (i) => `Create a Gmail draft to ${str(i.to)} — "${str(i.subject)}"`,
    exec: async (token, i) => {
      const r = await gmailCreateDraft(token, {
        to: str(i.to),
        subject: str(i.subject),
        body: str(i.body),
        cc: i.cc ? str(i.cc) : undefined,
      });
      return { output: JSON.stringify(r), summary: `Draft created to ${str(i.to)}` };
    },
  },
  {
    name: "gmail_send",
    kind: "write",
    definition: {
      name: "gmail_send",
      description: "Send an email from the user's Gmail account.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address(es)" },
          subject: { type: "string" },
          body: { type: "string" },
          cc: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
    describe: (i) =>
      `Send an email to ${str(i.to)} — "${str(i.subject)}"`,
    exec: async (token, i) => {
      const r = await gmailSend(token, {
        to: str(i.to),
        subject: str(i.subject),
        body: str(i.body),
        cc: i.cc ? str(i.cc) : undefined,
      });
      return {
        output: JSON.stringify(r),
        summary: `Email sent to ${str(i.to)}`,
      };
    },
  },
];

/**
 * Tools available to unattended automations. By default email can only be
 * DRAFTED (gmail_send excluded); automations explicitly opted into sending get
 * the full set including gmail_send.
 */
export const AUTOMATION_TOOL_NAMES = GOOGLE_TOOLS.map((t) => t.name).filter(
  (n) => n !== "gmail_send",
);

export const AUTOMATION_TOOL_NAMES_WITH_SEND = GOOGLE_TOOLS.map((t) => t.name);

export function automationToolNames(allowSend: boolean): string[] {
  return allowSend ? AUTOMATION_TOOL_NAMES_WITH_SEND : AUTOMATION_TOOL_NAMES;
}

export function getGoogleTool(name: string): GoogleTool | undefined {
  return GOOGLE_TOOLS.find((t) => t.name === name);
}

export function googleToolDefinitions() {
  return GOOGLE_TOOLS.map((t) => t.definition);
}

/** "Name <a@b.com>" | "a@b.com" → normalized address, or null if unparseable. */
function extractEmail(raw: string): string | null {
  const angled = raw.match(/<([^<>]+)>/);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function splitRecipients(v: unknown): string[] {
  return typeof v === "string"
    ? v.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    : [];
}

/** Allowlist entries: "a@b.com" matches exactly; "@b.com" matches the domain. */
function recipientAllowed(email: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e.includes("@")) return false;
    return e.startsWith("@") ? email.endsWith(e) : email === e;
  });
}

const rejectSend = (reason: string): GoogleToolResult => ({
  output: `gmail_send blocked: ${reason}`,
  summary: "Unattended send blocked",
  isError: true,
});

/**
 * Hard guardrails for unattended gmail_send, enforced in code before any API
 * call: EVERY recipient (to/cc/bcc) must match the automation's allowlist, and
 * the per-UTC-day counter must be under maxSendsPerDay. Returns an is_error
 * tool result to hand back to the model, or null to proceed.
 */
async function gateUnattendedSend(
  userId: string,
  ctx: ToolExecutionContext,
  input: Input,
): Promise<GoogleToolResult | null> {
  const auto = ctx.automation;
  if (!auto) {
    return rejectSend(
      "unattended sending is not permitted in this context. Create a Gmail draft instead.",
    );
  }
  const allowlist = (auto.sendAllowlist ?? []).filter((e) => e.trim());
  if (allowlist.length === 0) {
    // An allowSend automation with no allowlist can't send now (fail-closed).
    // Tell the owner once so a previously-working send isn't lost silently —
    // they may have upgraded past the change that made an allowlist required.
    try {
      await createNotification({
        userId,
        kind: "error",
        title: "Automation email blocked",
        body: "An automation tried to send email but has no recipient allowlist. Add allowed recipients in Automations to enable unattended sending.",
        link: "/automations",
      });
    } catch {
      // Non-fatal; the block itself still stands.
    }
    return rejectSend(
      "this automation has no recipient allowlist, so unattended sending is disabled. Create a Gmail draft instead.",
    );
  }
  const recipients = [
    ...splitRecipients(input.to),
    ...splitRecipients(input.cc),
    ...splitRecipients(input.bcc),
  ];
  if (recipients.length === 0) return rejectSend("no recipients given.");
  for (const raw of recipients) {
    const email = extractEmail(raw);
    if (!email || !recipientAllowed(email, allowlist)) {
      return rejectSend(
        `recipient "${raw}" is not on this automation's allowlist. Create a Gmail draft instead.`,
      );
    }
  }
  // Reserve a slot in the per-UTC-day counter atomically (UPDATE … WHERE) so
  // concurrent runs can't exceed the cap. Reserving before the API call means
  // a failed send still consumes a slot — the conservative direction.
  const today = new Date().toISOString().slice(0, 10);
  const reserved = await db
    .update(automations)
    .set({
      sendsToday: sql`CASE WHEN ${automations.sendsTodayDate} = ${today} THEN ${automations.sendsToday} + 1 ELSE 1 END`,
      sendsTodayDate: today,
    })
    .where(
      and(
        eq(automations.id, auto.id),
        sql`((${automations.sendsTodayDate} IS DISTINCT FROM ${today} AND ${automations.maxSendsPerDay} >= 1) OR (${automations.sendsTodayDate} = ${today} AND ${automations.sendsToday} < ${automations.maxSendsPerDay}))`,
      ),
    )
    .returning({ id: automations.id });
  if (reserved.length === 0) {
    return rejectSend(
      `this automation's daily send limit (${auto.maxSendsPerDay}/day) is reached. Create a Gmail draft instead.`,
    );
  }
  return null;
}

/** Every unattended send that goes through leaves an audit entry and an in-app
 * notification, so the owner always learns email went out on their behalf. */
async function auditUnattendedSend(
  userId: string,
  automationId: string,
  input: Input,
): Promise<void> {
  const detail = `Automation ${automationId} sent email to ${str(input.to)} — "${str(input.subject)}"`;
  await recordAudit({ userId, action: "automation.gmail_send", detail });
  try {
    await createNotification({
      userId,
      kind: "task_complete",
      title: "Automation sent an email",
      body: `To: ${str(input.to)} — "${str(input.subject)}"`,
      link: "/automations",
    });
  } catch {
    // The email is already out — a failed notification must not surface as a
    // send failure (the model could retry and send again).
  }
}

/** Execute a tool by name, resolving the user's access token. Never throws. */
export async function runGoogleTool(
  userId: string,
  name: string,
  input: Input,
  ctx?: ToolExecutionContext,
): Promise<GoogleToolResult> {
  const tool = getGoogleTool(name);
  if (!tool) {
    return { output: `Unknown tool: ${name}`, summary: "Unknown tool", isError: true };
  }
  try {
    if (name === "gmail_send" && ctx?.unattended) {
      const blocked = await gateUnattendedSend(userId, ctx, input);
      if (blocked) return blocked;
    }
    const token = await getValidAccessToken(userId);
    const result = await tool.exec(token, input);
    if (name === "gmail_send" && ctx?.unattended && !result.isError) {
      await auditUnattendedSend(userId, ctx.automation!.id, input);
    }
    return result;
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return {
        output:
          "The user has not connected their Google account. Ask them to connect it in Settings.",
        summary: "Google not connected",
        isError: true,
      };
    }
    return {
      output: `Error running ${name}: ${err instanceof Error ? err.message : "unknown"}`,
      summary: `${name} failed`,
      isError: true,
    };
  }
}
