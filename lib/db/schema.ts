import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export type Role = "ADMIN" | "MEMBER";
export type InvoiceStatus = "APPROVED" | "NEEDS_REVIEW" | "DENIED" | "PENDING";
export type CompanyRole = "OWNER" | "ADMIN" | "MEMBER";
export type TakeoffStatus = "created" | "uploading" | "indexing" | "indexed" | "processing" | "review" | "failed";
export type EngineJobStatus = "queued" | "running" | "done" | "failed";
/**
 * Meeting lifecycle. All writes go through `transitionMeeting` in
 * lib/meetings/state.ts (compare-and-swap) — never set `status` directly.
 * - detected:   auto-start row created, no audio yet
 * - active:     recording; live transcription session open
 * - degraded:   transcription lost after retries — recoverable back to active
 * - processing: closeout analysis running
 * - complete:   minutes exist (terminal)
 * - failed:     closeout failed (retryable via /end)
 * - abandoned:  swept by the janitor (terminal)
 * - ended:      legacy value from pre-state-machine failure paths; read-only
 *               alias of failed (retryable), never written anymore
 */
export type MeetingStatus =
  | "detected"
  | "active"
  | "degraded"
  | "processing"
  | "complete"
  | "failed"
  | "abandoned"
  | "ended";
export type MeetingSource = "manual" | "desktop" | "browser" | "calendar" | "import";
export type MeetingEventType =
  | "project_update"
  | "safety"
  | "scheduling"
  | "procurement"
  | "budget"
  | "equipment"
  | "rfi"
  | "submittal"
  | "quality"
  | "change_order"
  | "client_request"
  | "risk"
  | "question"
  | "action_item"
  | "decision"
  | "follow_up"
  | "general";
export type MeetingRiskType =
  | "safety"
  | "schedule"
  | "budget"
  | "material"
  | "design"
  | "quality"
  | "other";
export type MeetingPriority = "low" | "medium" | "high";

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
  // dataBase64 holds the attachment bytes so later turns can resend the real
  // image/document to the model (absent on legacy rows → text placeholder).
  | { type: "image"; mime: string; name: string; dataBase64?: string }
  | { type: "document"; mime: string; name: string; dataBase64?: string }
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

/** Per-turn options persisted when a turn pauses for tool confirmation, so the
 * confirm/resume path can rebuild the exact request (model, toggles, prompt
 * notes) instead of falling back to conversation defaults. */
export type PendingResumeOptions = {
  model: string;
  effort: string;
  researchMode?: boolean;
  webSearch?: boolean;
  thinking?: boolean;
  /** Reasoning-mode id (lib/claude/modes.ts). */
  mode?: string;
  selfCheck?: boolean;
  voice?: boolean;
};

/** A tool call awaiting user confirmation (stored on the conversation). */
export type PendingToolUse = {
  id: string;
  name: string;
  input: unknown;
  kind: "read" | "write";
  /** Resume options for the paused turn — set on the first entry only. */
  resume?: PendingResumeOptions;
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
  // Bumped on password/role change or "sign out all devices"; JWTs carry the
  // version they were minted with and are rejected when stale.
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Durable fixed-window rate-limit counters (no external store needed).
 * Key convention: "<scope>:<identifier>", e.g. "signin:203.0.113.7" or
 * "signin-email:user@example.com". See lib/rate-limit.ts. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartAt: timestamp("window_start_at").notNull().defaultNow(),
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
}, (t) => ({
  userIdx: index("google_accounts_user_id_idx").on(t.userId),
}));

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  // Meeting recording governance. Null retention = keep transcripts forever;
  // a positive value lets the janitor purge transcript segments + embeddings
  // older than N days. When consent is required, the client must show the
  // notice and the session records acknowledgement before capture.
  transcriptRetentionDays: integer("transcript_retention_days"),
  recordingConsentRequired: boolean("recording_consent_required")
    .notNull()
    .default(false),
  recordingConsentText: text("recording_consent_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Company = typeof companies.$inferSelect;

export const memberships = pgTable("memberships", {
  id: id(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<CompanyRole>().notNull().default("MEMBER"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Membership = typeof memberships.$inferSelect;

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

export type MeetingState = {
  currentProject?: string;
  currentProjectId?: string | null;
  currentTopic?: string;
  currentSpeaker?: string;
  currentDiscussion?: string;
  currentRisks?: string[];
  currentActionItems?: string[];
  currentDecisions?: string[];
  meetingStage?: string;
  confidence?: number;
  updatedAt?: string;
  /** Discussion categories present in the meeting (from the Classifier agent). */
  categories?: string[];
  /** Company knowledge surfaced by the Memory/RAG agent (drawings, RFIs, vendors, …). */
  relatedKnowledge?: {
    label: string;
    detail?: string;
    refType?: string;
    source?: string;
    link?: string;
  }[];
};

export const meetingSessions = pgTable("meeting_sessions", {
  id: id(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  status: text("status").$type<MeetingStatus>().notNull().default("active"),
  source: text("source").$type<MeetingSource>().notNull().default("manual"),
  detectedApp: text("detected_app"),
  detectionConfidence: integer("detection_confidence").notNull().default(0),
  consentConfirmed: boolean("consent_confirmed").notNull().default(false),
  autoStartApproved: boolean("auto_start_approved").notNull().default(false),
  rawAudioEnabled: boolean("raw_audio_enabled").notNull().default(false),
  transcriptProvider: text("transcript_provider").notNull().default("assemblyai"),
  state: jsonb("state").$type<MeetingState>(),
  summary: text("summary"),
  minutesMarkdown: text("minutes_markdown"),
  qaNotes: jsonb("qa_notes").$type<string[]>(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // At most ONE live desktop meeting per owner — makes the auto-start
  // check-then-insert race impossible at the database layer. The auto-start
  // route inserts with ON CONFLICT DO NOTHING and re-selects on conflict.
  oneLiveDesktopMeetingPerOwner: uniqueIndex("one_live_desktop_meeting_per_owner")
    .on(t.ownerId)
    .where(sql`${t.source} = 'desktop' AND ${t.status} IN ('detected', 'active', 'degraded')`),
}));
export type MeetingSession = typeof meetingSessions.$inferSelect;

export const meetingParticipants = pgTable("meeting_participants", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  speakerLabel: text("speaker_label").notNull(),
  role: text("role"),
  confidence: integer("confidence").notNull().default(0),
  isHost: boolean("is_host").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MeetingParticipant = typeof meetingParticipants.$inferSelect;

export const speakerProfiles = pgTable("speaker_profiles", {
  id: id(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  embeddingEnc: text("embedding_enc"),
  enrollmentStatus: text("enrollment_status")
    .$type<"not_started" | "enrolled" | "needs_refresh">()
    .notNull()
    .default("not_started"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SpeakerProfile = typeof speakerProfiles.$inferSelect;

export const transcriptSegments = pgTable("transcript_segments", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull().default(0),
  speakerLabel: text("speaker_label").notNull().default("Speaker A"),
  speakerName: text("speaker_name"),
  text: text("text").notNull(),
  startMs: integer("start_ms").notNull().default(0),
  endMs: integer("end_ms").notNull().default(0),
  confidence: integer("confidence").notNull().default(0),
  isFinal: boolean("is_final").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type TranscriptSegment = typeof transcriptSegments.$inferSelect;

export const meetingEvents = pgTable("meeting_events", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  type: text("type").$type<MeetingEventType>().notNull().default("general"),
  title: text("title").notNull(),
  detail: text("detail"),
  speakerLabel: text("speaker_label"),
  timestampMs: integer("timestamp_ms").notNull().default(0),
  confidence: integer("confidence").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MeetingEvent = typeof meetingEvents.$inferSelect;

export const meetingActionItems = pgTable("meeting_action_items", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  ownerName: text("owner_name"),
  task: text("task").notNull(),
  priority: text("priority").$type<MeetingPriority>().notNull().default("medium"),
  dueDate: text("due_date"),
  status: text("status").notNull().default("open"),
  confidence: integer("confidence").notNull().default(0),
  sourceTimestampMs: integer("source_timestamp_ms").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MeetingActionItem = typeof meetingActionItems.$inferSelect;

export const meetingDecisions = pgTable("meeting_decisions", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  decision: text("decision").notNull(),
  reason: text("reason"),
  supportingDiscussion: text("supporting_discussion"),
  approvedBy: text("approved_by"),
  timestampMs: integer("timestamp_ms").notNull().default(0),
  confidence: integer("confidence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MeetingDecision = typeof meetingDecisions.$inferSelect;

export const meetingRisks = pgTable("meeting_risks", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  riskType: text("risk_type").$type<MeetingRiskType>().notNull().default("other"),
  description: text("description").notNull(),
  severity: text("severity").$type<MeetingPriority>().notNull().default("medium"),
  mitigation: text("mitigation"),
  confidence: integer("confidence").notNull().default(0),
  sourceTimestampMs: integer("source_timestamp_ms").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MeetingRisk = typeof meetingRisks.$inferSelect;

export const meetingArtifacts = pgTable("meeting_artifacts", {
  id: id(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  type: text("type")
    .$type<"minutes" | "summary" | "markdown" | "html" | "word" | "pdf" | "spreadsheet" | "email">()
    .notNull(),
  title: text("title").notNull(),
  mime: text("mime").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MeetingArtifact = typeof meetingArtifacts.$inferSelect;

export const meetingEmbeddings = pgTable("meeting_embeddings", {
  id: id(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetingSessions.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  content: text("content").notNull(),
  // pgvector column for semantic memory (spec §12). Requires the pgvector
  // extension: run `CREATE EXTENSION IF NOT EXISTS vector;` before db:push.
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  embeddingIdx: index("meeting_embeddings_embedding_idx").using(
    "hnsw",
    t.embedding.op("vector_cosine_ops"),
  ),
}));
export type MeetingEmbedding = typeof meetingEmbeddings.$inferSelect;

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
}, (t) => ({
  projectIdx: index("project_files_project_id_idx").on(t.projectId),
}));

/** Chunked embeddings of text-extractable project files, for semantic Project
 * Knowledge Search (pgvector KNN, mirroring meeting_embeddings). Populated
 * lazily by lib/retrieval.ts when embeddings are configured; the search path
 * falls back to Postgres full-text when they aren't. */
export const projectFileEmbeddings = pgTable("project_file_embeddings", {
  id: id(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fileId: text("file_id")
    .notNull()
    .references(() => projectFiles.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("project_file_embeddings_project_id_idx").on(t.projectId),
  fileIdx: index("project_file_embeddings_file_id_idx").on(t.fileId),
  embeddingIdx: index("project_file_embeddings_embedding_idx").using(
    "hnsw",
    t.embedding.op("vector_cosine_ops"),
  ),
}));
export type ProjectFileEmbedding = typeof projectFileEmbeddings.$inferSelect;

export const takeoffProjects = pgTable("takeoff_projects", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  engineProjectId: text("engine_project_id").notNull(),
  // Chat conversation that spawned this takeoff (null for the standalone
  // wizard). Lets chat follow-ups reuse the engine project instead of
  // re-uploading. set null on conversation delete so the takeoff survives.
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  // Provenance: the chat message that triggered the takeoff (optional).
  sourceMessageId: text("source_message_id"),
  name: text("name").notNull(),
  status: text("status").$type<TakeoffStatus>().notNull().default("created"),
  engineJobId: text("engine_job_id"),
  jobStatus: text("job_status").$type<EngineJobStatus>(),
  jobProgress: text("job_progress").notNull().default(""),
  jobError: text("job_error"),
  takeoffInstructions: text("takeoff_instructions").notNull().default(""),
  takeoffScope: jsonb("takeoff_scope").$type<unknown>(),
  processStartedAt: timestamp("process_started_at"),
  lastPolledAt: timestamp("last_polled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("takeoff_projects_user_id_idx").on(t.userId),
  conversationIdx: index("takeoff_projects_conversation_id_idx").on(t.conversationId),
  engineProjectUnique: uniqueIndex("takeoff_projects_engine_project_id_key").on(t.engineProjectId),
}));
export type TakeoffProject = typeof takeoffProjects.$inferSelect;

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
}, (t) => ({
  userIdx: index("conversations_user_id_idx").on(t.userId),
}));

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
}, (t) => ({
  conversationIdx: index("messages_conversation_id_idx").on(t.conversationId),
  parentIdx: index("messages_parent_id_idx").on(t.parentId),
}));

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
  // Prompt-cache token classes (billed at different rates than plain input).
  cacheCreationInputTokens: integer("cache_creation_input_tokens")
    .notNull()
    .default(0),
  cacheReadInputTokens: integer("cache_read_input_tokens")
    .notNull()
    .default(0),
  // Fractional cents (double precision) so small Haiku calls stop rounding
  // to $0.00; aggregate SUMs stay estimate-grade, which is all this is.
  costCents: doublePrecision("cost_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("usage_events_user_id_idx").on(t.userId),
  createdIdx: index("usage_events_created_at_idx").on(t.createdAt),
}));

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
  // When true, this automation may SEND email unattended (not just draft one).
  allowSend: boolean("allow_send").notNull().default(false),
  // Unattended-send guardrails (enforced in code, not prompt): recipients must
  // match an entry here — a full address ("a@b.com") or a domain ("@b.com").
  // Null/empty means NO unattended sends even when allowSend is true.
  sendAllowlist: jsonb("send_allowlist").$type<string[]>(),
  // Hard cap on unattended sends per UTC day (counter below resets daily).
  maxSendsPerDay: integer("max_sends_per_day").notNull().default(10),
  sendsToday: integer("sends_today").notNull().default(0),
  sendsTodayDate: text("sends_today_date"), // "YYYY-MM-DD" (UTC)
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
}, (t) => ({
  automationIdx: index("automation_runs_automation_id_idx").on(t.automationId),
}));

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
  // Anthropic Skills API linkage. Set when a skill with reference files is
  // uploaded via client.beta.skills.create so it can run in a code-execution
  // container at runtime; null for plain text-instruction packs.
  anthropicSkillId: text("anthropic_skill_id"),
  anthropicSkillVersion: text("anthropic_skill_version"),
  // True when this skill must execute in an Anthropic code-execution container
  // (it ships reference files/scripts). Text-only packs stay false and are
  // injected into the system prompt with zero container cost.
  execInContainer: boolean("exec_in_container").notNull().default(false),
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

/** Per-user remote MCP server connections (Connections marketplace). */
export const mcpConnections = pgTable("mcp_connections", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Catalog entry id (e.g. "notion") or "custom" for a hand-entered server.
  serverId: text("server_id").notNull(),
  // Unique-per-user identifier used as the mcp_server_name in requests.
  name: text("name").notNull(),
  url: text("url").notNull(),
  // Encrypted OAuth/bearer token (via lib/crypto); null for no-auth servers.
  authTokenEnc: text("auth_token_enc"),
  enabled: boolean("enabled").notNull().default(true),
  // Write-tool gating: MCP tools execute server-side (Anthropic connects to
  // the server directly), so gating happens by restricting which tools are
  // exposed at request time. Default: read-only tools only.
  allowWrites: boolean("allow_writes").notNull().default(false),
  // Optional explicit tool allowlist (names). Null = all tools that pass the
  // read/write policy above.
  allowedTools: jsonb("allowed_tools").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type McpConnection = typeof mcpConnections.$inferSelect;

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
}, (t) => ({
  userIdx: index("notifications_user_id_idx").on(t.userId),
}));
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
}, (t) => ({
  userIdx: index("audit_log_user_id_idx").on(t.userId),
  createdIdx: index("audit_log_created_at_idx").on(t.createdAt),
}));
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
