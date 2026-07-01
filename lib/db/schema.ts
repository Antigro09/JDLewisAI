import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  type AnyPgColumn,
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
  darkMode?: "light" | "dark" | "system";
  emailNotifications?: boolean;
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
  pinned: boolean("pinned").notNull().default(false),
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
  // Tip of the currently-active branch (walk `messages.parentId` from here to
  // the root to get the rendered thread). Null = unbranched / empty.
  activeLeafId: text("active_leaf_id").references(
    (): AnyPgColumn => messages.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: id(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  // Self-reference for branching: null = root message. Editing a message
  // creates a new sibling (same parentId); deleting cascades its subtree.
  parentId: text("parent_id").references((): AnyPgColumn => messages.id, {
    onDelete: "cascade",
  }),
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

/** Files attached to a skill: the parsed SKILL.md itself + reference docs. */
export const skillFiles = pgTable("skill_files", {
  id: id(),
  skillId: text("skill_id")
    .notNull()
    .references(() => skills.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  data: text("data").notNull(), // base64-encoded content (MVP storage)
  kind: text("kind").$type<"primary" | "reference">().notNull().default("reference"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type SkillFile = typeof skillFiles.$inferSelect;

export type MemoryCategory =
  | "standard"
  | "preference"
  | "vendor"
  | "material"
  | "method"
  | "lesson"
  | "project"
  | "other";

/** Long-term memory (Phase 6): durable facts the AI recalls in every chat —
 * company standards, preferred subs/materials, writing style, lessons, etc.
 * Personal (owner-scoped) or org-wide (admin-managed). */
export const memories = pgTable("memories", {
  id: id(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").$type<"personal" | "org">().notNull().default("personal"),
  category: text("category").$type<MemoryCategory>().notNull().default("other"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Memory = typeof memories.$inferSelect;

/** Reusable saved prompts / workflows (Phase 6), inserted into chat with one click. */
export const prompts = pgTable("prompts", {
  id: id(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").$type<"personal" | "org">().notNull().default("personal"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Prompt = typeof prompts.$inferSelect;

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

export type SubmittalStatus =
  | "PENDING"
  | "APPROVED"
  | "APPROVED_AS_NOTED"
  | "REVISE"
  | "REJECTED";

/** Submittal log entries (additional feature). */
export const submittals = pgTable("submittals", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  specSection: text("spec_section"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status")
    .$type<SubmittalStatus>()
    .notNull()
    .default("PENDING"),
  ballInCourt: text("ball_in_court"),
  dueDate: text("due_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Submittal = typeof submittals.$inferSelect;

export type RfiStatus = "OPEN" | "ANSWERED" | "CLOSED";

/** Request for Information log. */
export const rfis = pgTable("rfis", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  rfiNumber: text("rfi_number"),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  discipline: text("discipline"),
  assignedTo: text("assigned_to"),
  dueDate: text("due_date"),
  status: text("status").$type<RfiStatus>().notNull().default("OPEN"),
  response: text("response"),
  generatedDraft: text("generated_draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Rfi = typeof rfis.$inferSelect;

export type ChangeOrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

/** Change order drafts. */
export const changeOrders = pgTable("change_orders", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  coNumber: text("co_number"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  reason: text("reason"),
  costImpact: text("cost_impact"),
  scheduleImpact: text("schedule_impact"),
  status: text("status")
    .$type<ChangeOrderStatus>()
    .notNull()
    .default("DRAFT"),
  generatedDraft: text("generated_draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ChangeOrder = typeof changeOrders.$inferSelect;

/** Daily construction site reports. */
export const dailyReports = pgTable("daily_reports", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  reportDate: text("report_date").notNull(),
  weather: text("weather"),
  laborNotes: text("labor_notes"),
  workPerformed: text("work_performed"),
  issues: text("issues"),
  generatedReport: text("generated_report"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type DailyReport = typeof dailyReports.$inferSelect;

/** Bid / estimate comparison records. */
export const bids = pgTable("bids", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  trade: text("trade"),
  vendors: jsonb("vendors").$type<
    { name: string; totalAmt: string; notes?: string }[]
  >(),
  analysis: text("analysis"),
  recommendation: text("recommendation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Bid = typeof bids.$inferSelect;

export type NotificationKind = "approval_needed" | "task_complete" | "error";

/** In-app notifications for background work the user might need to act on. */
export const notifications = pgTable("notifications", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<NotificationKind>().notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Notification = typeof notifications.$inferSelect;

/** Audit trail (Phase 6): a record of AI actions for compliance & debugging. */
export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // e.g. "chat.message", "tool.docs_create", "automation.run"
  detail: text("detail"),
  conversationId: text("conversation_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type AuditEntry = typeof auditLog.$inferSelect;

export type DocumentTemplateKind =
  | "rfi"
  | "change_order"
  | "daily_report"
  | "eap"
  | "proposal"
  | "scope_of_work"
  | "general";

/** Org-wide document branding (logo, header/footer, color) applied when
 * viewing/printing generated documents. v1 only ever has one row (kind
 * "general"); the column is kept for future per-document-type overrides. */
export const documentTemplates = pgTable("document_templates", {
  id: id(),
  kind: text("kind").$type<DocumentTemplateKind>().notNull().default("general"),
  name: text("name").notNull(),
  logo: text("logo"), // data: URI (e.g. "data:image/png;base64,...."), nullable
  headerText: text("header_text"),
  footerText: text("footer_text"),
  brandColor: text("brand_color"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DocumentTemplate = typeof documentTemplates.$inferSelect;

export type AppUser = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ScopeOfWork = typeof scopesOfWork.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
