import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export type Role = "ADMIN" | "MEMBER";
export type InvoiceStatus = "APPROVED" | "NEEDS_REVIEW" | "DENIED" | "PENDING";

/** Per-user personalization folded into the system prompt. */
export type Personalization = {
  displayRole?: string; // e.g. "Project Manager", "Estimator"
  tone?: string; // e.g. "concise and direct"
  about?: string; // free-form context about the user / their work
  defaultModel?: string;
  defaultEffort?: string;
};

/** A single chat message stored as structured content blocks. */
export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; mime: string; name: string }
  | { type: "document"; mime: string; name: string }
  // Replay-critical: assistant tool call (id) and its result (toolUseId).
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      name: string;
      output: string; // model-facing content (often JSON)
      summary?: string; // short, human-friendly line for the UI
      link?: string; // e.g. a Drive/Doc/Sheet URL
      isError?: boolean;
    };

/** A tool call awaiting user confirmation (stored on the conversation). */
export type PendingToolUse = {
  id: string;
  name: string;
  input: unknown;
  kind: "read" | "write";
};

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<Role>().notNull().default("MEMBER"),
  personalization: jsonb("personalization").$type<Personalization>(),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Per-user Google OAuth linkage (Phase 2). Tokens stored encrypted. */
export const googleAccounts = pgTable("google_accounts", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  googleEmail: text("google_email"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  scope: text("scope"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: id(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions"), // custom project context injected into prompts
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectFiles = pgTable("project_files", {
  id: id(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  data: text("data").notNull(), // base64-encoded content (MVP storage)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull().default("New chat"),
  model: text("model").notNull(),
  effort: text("effort").notNull().default("high"),
  // Tool calls paused awaiting user confirmation (write/send actions).
  pendingToolUses: jsonb("pending_tool_uses").$type<PendingToolUse[]>(),
  // Set when this conversation is the transcript of an automation run (hidden
  // from the chat sidebar).
  automationId: text("automation_id"),
  // Explicit skill selection for this conversation; null = use the user's
  // default-active skills.
  skillIds: jsonb("skill_ids").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: id(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  blocks: jsonb("blocks").$type<MessageBlock[]>().notNull(),
  // Verbatim Anthropic API content for assistant turns (preserves thinking
  // signatures + tool_use blocks for exact replay across tool/confirm steps).
  rawContent: jsonb("raw_content").$type<unknown[]>(),
  model: text("model"),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  type: text("type").$type<"code" | "document" | "sheet" | "file">().notNull(),
  title: text("title").notNull(),
  language: text("language"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  fileName: text("file_name").notNull(),
  fileMime: text("file_mime").notNull(),
  fileData: text("file_data").notNull(), // base64
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  status: text("status").$type<InvoiceStatus>().notNull().default("PENDING"),
  notes: text("notes"),
  reviewerId: text("reviewer_id").references(() => users.id, {
    onDelete: "set null",
  }),
  history: jsonb("history").$type<
    { at: string; by: string; status: InvoiceStatus; note?: string }[]
  >(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ScopeSections = {
  workIncluded: string[];
  exclusions: string[];
  assumptions: string[];
  requiredInspections: string[];
  requiredPermits: string[];
  requiredSubmittals: string[];
  closeoutRequirements: string[];
};

export const scopesOfWork = pgTable("scopes_of_work", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  trade: text("trade").notNull(),
  title: text("title").notNull(),
  sections: jsonb("sections").$type<ScopeSections>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  feature: text("feature").notNull().default("chat"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Scheduled, unattended automations (Phase 3). */
export const automations = pgTable("automations", {
  id: id(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  trigger: jsonb("trigger").$type<Record<string, unknown>>(),
  instructions: text("instructions").notNull(),
  status: text("status").$type<"active" | "paused">().notNull().default("paused"),
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  model: text("model"),
  effort: text("effort"),
  state: jsonb("state").$type<Record<string, unknown>>(),
  lastError: text("last_error"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const automationRuns = pgTable("automation_runs", {
  id: id(),
  automationId: text("automation_id")
    .notNull()
    .references(() => automations.id, { onDelete: "cascade" }),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status")
    .$type<"running" | "success" | "error">()
    .notNull()
    .default("running"),
  summary: text("summary"),
  error: text("error"),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;

/** Reusable instruction packs (Phase 4). Personal or org-wide. */
export const skills = pgTable("skills", {
  id: id(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").$type<"personal" | "org">().notNull().default("personal"),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions").notNull(),
  // Applied to chats by default (user can still toggle per-conversation).
  defaultActive: boolean("default_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Skill = typeof skills.$inferSelect;

/** Per-user / org capability (plugin) toggles (Phase 4). */
export const pluginSettings = pgTable("plugin_settings", {
  id: id(),
  scope: text("scope").$type<"user" | "org">().notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  enabled: boolean("enabled").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type PluginSetting = typeof pluginSettings.$inferSelect;

export type AppUser = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ScopeOfWork = typeof scopesOfWork.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
