# AI Meeting Intelligence System — Architecture & Design

> Status: **Design for approval + phased implementation.** This document is deliverable #1–#6
> from the spec (architecture, reasoning, technology recommendations, challenges, improvements,
> roadmap). It is written against the *actual* codebase (Next.js 15 App Router, Drizzle ORM on
> Neon Postgres, custom JWT auth, the Anthropic Claude API, the existing `lib/agents` multi-agent
> orchestrator, and the Electron shell + meeting tables already merged to `main`).

---

## 0. Where we are today (honest baseline)

A first `meeting agent` commit already landed on `main`. It is a useful skeleton but **not** the
system the spec describes, and it does not currently build. Concretely:

| Area | Current state | Gap vs. spec |
| --- | --- | --- |
| Build | `tsc`/`next build` fail (`ws` has no types; two implicit `any`s) | Must compile before anything ships |
| Detection (§1) | Real scoring + Electron PowerShell process scan | OK for v1; no true WebRTC/audio-session probing |
| Audio (§2) | Browser mic + `getDisplayMedia` mixed to 16 kHz PCM16 | Desktop WASAPI loopback is a **stub** |
| Transcription (§3) | Real AssemblyAI v3 streaming WS | Sound choice; see comparison below |
| Diarization (§4) | AssemblyAI "Speaker A/B/C" only | **No** speaker identification; `speaker_profiles`/embeddings declared but never used |
| Agents (§6) | **One** Claude call whose prompt says "act as agents" | Directly violates "do NOT use one LLM prompt" |
| Memory (§12) | `ILIKE` keyword search | No semantic/FTS ranking; `meeting_embeddings` never populated |
| RAG (§13) | Not implemented | Table exists, nothing embeds or retrieves |
| Live state (§5/§16) | 5 s polling | Works, but not push/real-time |
| Scale (§18) | Live sessions in a **module-global `Map`** | Breaks on Vercel serverless (audio POST hits a different lambda than the socket) |

The design below keeps what is good (AssemblyAI streaming, browser capture, the Drizzle schema)
and fixes the four things that make it "a recorder" instead of "an intelligence system": **real
agents, real memory/RAG, real speaker identity, and a serverless-safe realtime path.**

---

## 1. Goals & non-goals

**Goals (from the spec):** auto-detect meetings; low-friction capture of mic + system audio;
real-time streaming transcription with punctuation/timestamps; diarization → identification;
continuously-updated live meeting state; a *modular, agent-based* understanding layer (not one
prompt); classification, project tracking, action items, decisions, risks, follow-ups; searchable
memory; RAG against company knowledge; QA-checked branded minutes; multi-format export; a live
dashboard; multi-tenant, horizontally-scalable production posture.

**Non-goals (v1):** replacing the meeting platforms themselves; server-side recording of raw
audio at rest (we stream and discard by default — see privacy §8); mobile capture; real-time
translation. These are roadmap items, not commitments.

---

## 2. High-level architecture

Three planes, so the latency-critical live path is isolated from the heavy post-processing and
from the serverless web app.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENTS                                                                        │
│  • Electron desktop shell  →  detection (process/window/WebRTC), WASAPI        │
│    loopback via native sidecar, mic capture                                    │
│  • Browser (Next.js app)   →  getUserMedia + getDisplayMedia, live dashboard   │
└───────────────┬───────────────────────────────────────────────┬───────────────┘
                │ PCM16 16 kHz frames (WS)                        │ HTTPS (app, auth, CRUD)
                ▼                                                 ▼
┌───────────────────────────────────┐        ┌──────────────────────────────────┐
│ REALTIME MEETING GATEWAY          │        │ NEXT.JS APP (Vercel)              │
│ (dedicated long-lived Node svc)   │        │  • auth, RBAC, multi-tenant       │
│  • 1 WS per participant stream     │        │  • meetings CRUD, dashboard SSR   │
│  • relays audio → AssemblyAI       │        │  • export, settings, enrollment   │
│  • receives transcript turns       │        │  • Server Actions / route handlers│
│  • runs LIVE agent loop (cheap)    │        └───────────────┬───────────────────┘
│  • writes live state → Redis       │                        │
│  • pushes deltas → dashboard (WS)  │                        │ enqueue job on meeting end
│  • persists finals → Postgres      │                        ▼
└───────────────┬───────────────────┘        ┌──────────────────────────────────┐
                │ finals                       │ POST-MEETING WORKER (queue)       │
                ▼                              │  • Planner → specialist agents    │
┌───────────────────────────────────┐         │  • Minutes → QA                   │
│ DATA PLANE                         │◄────────┤  • embed transcript → memory/RAG  │
│  • Postgres/Neon (source of truth) │         │  • notifications + email          │
│    + pgvector (memory/RAG)         │         └──────────────────────────────────┘
│  • Redis/Upstash (live state, pub) │
│  • Object store (optional audio)   │
└───────────────────────────────────┘
```

**Why three planes.** The single biggest defect in the current build is holding an AssemblyAI
WebSocket in a module-global `Map` inside Next.js. Vercel functions are ephemeral and horizontally
replicated, so the socket and the audio chunks that feed it will land on different instances. A
long-lived stream needs a **stateful, long-lived process** — that is the *Realtime Meeting
Gateway*, deployed on a platform that supports persistent connections (Railway / Fly.io / Render /
a container on ECS). The Next.js app stays stateless and serverless (its strength: SSR, auth,
CRUD). Heavy LLM work happens off the request path in a **queue worker** so a 20-second meeting
end never blocks a request and can retry on failure.

This is a deliberate evolution of the existing Phase-3 plan, which already anticipated "a separate
long-running worker service (Render/Railway/Fly) handles background automations."

---

## 3. Component design (mapped to spec §1–§16)

### §1 Meeting Detection
A **signal-fusion scorer** (already prototyped in `lib/meetings/detection.ts`) that combines
weighted signals rather than a fixed app list, so future/unknown WebRTC apps still trigger:

- **Desktop (Electron):** enumerate processes + active-window titles (Windows: `Get-Process`;
  macOS later: `NSWorkspace`/`CGWindowList`). Weighted match against a *seed* list (Teams, Zoom,
  Discord, Slack, Webex, GoTo, RingCentral, TeamViewer) but any process using the mic + producing
  system audio scores highly on its own.
- **Browser:** the in-app tab knows its own URL; for *other* tabs we rely on the Electron shell.
  **WebRTC detection**: override/inspect `RTCPeerConnection` in the app context; in the shell,
  detect active `getUserMedia`/audio sessions. (We cannot read another Chrome profile's WebRTC
  internals — documented limitation.)
- **Audio-session monitoring:** mic-in-use + speaker-out activity are strong signals (OS audio
  session APIs via the native sidecar).
- **Calendar (future):** the app already has Google OAuth; a Calendar scope lets us pre-arm
  detection around scheduled events and pre-load project context.
- **Output:** `{ likely, confidence 0–100, app, reasons[] }`. At ≥70 we raise the confirm prompt
  ("Construction meeting detected. Start Meeting Intelligence?"). **Consent-first**: we never
  auto-record without the one-time per-meeting (or per-user "always for this app") confirmation —
  this is both a UX and a legal requirement (§8).

### §2 Audio Capture
- **Browser:** `getUserMedia` (mic, echo-cancel/noise-suppress/AGC on) + `getDisplayMedia`
  (tab/system audio) mixed in Web Audio, down-sampled to 16 kHz mono PCM16 — this part of the
  current build is sound and we keep it.
- **Desktop (the real gap):** Chromium's `desktopCapturer` loopback is unreliable for
  *participant* audio. The production answer is a **native WASAPI loopback sidecar** (a small Rust
  binary using `cpal`/`wasapi`, shipped with Electron and spoken to over IPC/stdio) that captures
  the render endpoint (what the speakers play) independently of the mic. This also cleanly gives
  us **separate streams** (mic vs. system) so diarization has an easy first cut ("me" vs.
  "everyone else") and handles **device switching** (subscribe to WASAPI device-change events and
  re-attach). Bluetooth/USB/multi-device are handled by the OS enumerating endpoints; we pick
  default + let the user override.
- **macOS (future):** ScreenCaptureKit (system audio) + CoreAudio taps; same sidecar contract.
- Two streams are preferred; when only one is available we send the mix and rely on the model's
  diarization.

### §3 Streaming Speech Recognition — see comparison in §"Technology" below.
Primary: **AssemblyAI Universal-Streaming** (you already have the key). Frame cadence 50–100 ms,
partial + final turns, punctuation, per-word timestamps, end-of-turn detection (→ "incomplete
thoughts"/interruptions). We keep a provider interface (`TranscriptionProvider`) so Deepgram or
Speechmatics can be swapped without touching the pipeline.

### §4 Speaker Diarization → Identification
Two layers, because they are different problems:
1. **Live diarization (who is speaking now):** AssemblyAI's streaming speaker labels give us
   A/B/C in real time. The mic-vs-system split further disambiguates the local user.
2. **Cross-meeting identification (which *person* is A):** a **voiceprint** service. On the
   post-meeting worker (or a dedicated diarization microservice), compute speaker **embeddings**
   with a SOTA model — **pyannote 3.x** or **NVIDIA NeMo TitaNet / Sortformer** (ECAPA-TDNN-class)
   — per diarized segment. Compare (cosine) against enrolled employee voiceprints in
   `speaker_profiles.embedding` (pgvector). Match ≥ threshold → auto-label; in the ambiguous band
   → **ask the user once**, store the confirmed mapping, and never ask again; below → **"Unknown
   Speaker."** Enrollment = a 20–30 s sample recorded once in Settings.
   - *Note on serverless:* embedding models are Python/GPU; they run in the worker/microservice,
     never in Next.js. Until that service exists, v1 ships **manual name-mapping that persists**
     (name "Speaker A" → Kevin for this meeting and remember the label), which is the correct data
     model and UX seam for the automatic version.

### §5 Live Meeting State
A single JSON document per meeting held in **Redis** (authoritative for "live") and mirrored to
`meeting_sessions.state`: `{ currentProject, currentTopic, currentSpeaker, currentDiscussion,
openRisks[], openActionItems[], recentDecisions[], stage, confidence, updatedAt }`. The live agent
loop patches it on every final turn; the dashboard subscribes via WS (fallback: the existing
5 s poll). Redis gives us cheap fan-out to multiple dashboard viewers and survives gateway
restarts.

### §6 Agent Architecture — the heart of the redesign (detailed in §4-agents below).

### §7 Conversation Understanding
A **Classifier agent** tags each *turn cluster* (a few turns of coherent discussion) into the
spec's 18 categories. Classification is cheap and runs live; it drives which heavier specialists
the Planner invokes (e.g., only wake the Safety agent when a turn is tagged `safety`/`risk`). This
"understand, then route" is what makes it agentic rather than one big summarizer.

### §8 Project Detection
A **Project Detection agent** with a *sticky context* rule: once a project is named ("Talbot
Park"), it becomes `currentProject` and every subsequent event inherits it until another project
is named or the topic clearly shifts. It reconciles spoken names against the tenant's real
`projects` rows (fuzzy match) and also tracks sub-context: building / floor / area / trade /
contractor / equipment / materials (stored on events as structured metadata).

### §9 Action Items / §10 Decisions / §11 Risks
Three focused extraction agents, each with a strict JSON contract and a **confidence** score, each
instructed to capture **implied** assignments (not just "I will…" but "someone needs to chase the
steel submittal" → owner inferred or left null with lower confidence). Risks are typed (safety /
schedule / budget / material / design / quality) and high-severity ones are flagged immediately to
the live dashboard and (optionally) the existing notification + email system.

### §12 Memory
Every finalized meeting is indexed for retrieval two ways: **Postgres full-text search**
(`tsvector`, ships first — no new dependency) for exact/keyword queries, and **pgvector semantic
search** over transcript chunks + extracted items (phase 2). Queries like "when did Kevin discuss
roof rails?" resolve to (person-filter on `speaker_name`) × (semantic/FTS match) × (time sort).

### §13 RAG Integration
A **Memory/RAG agent**: when the classifier sees references to a drawing / spec / RFI / submittal /
vendor / equipment, it retrieves from the tenant's existing knowledge — `project_files`, `rfis`,
`submittals`, `change_orders`, prior meetings — and surfaces the top hits live ("📎 RFI-014
referenced"). This reuses the platform's existing construction records instead of a bolt-on store.

### §14 Minutes + QA
Post-meeting, the **Planner** assembles a structured brief from all agent outputs → the **Minutes
agent** writes company-format minutes (branded via the existing `documentTemplates` /
`BrandedDocument` pipeline) → the **QA agent** verifies the spec's checklist (no missing
attendees/projects/action-items/decisions, no duplicates, consistent formatting, professional
language) and either passes or sends one revision loop back to Minutes.

### §15 Export
Markdown / HTML / email summary / action-item CSV already exist. We add **real `.docx`** (the
`docx` npm library, not HTML-with-a-`.doc`-extension) and **real PDF** (Playwright/Chromium — which
is already provisioned in this environment — rendering the branded HTML → PDF).

### §16 Live Dashboard
Transcript, current speaker, detected project, action items, risks, decisions, a meeting timeline,
and confidence scores — subscribed over WS to the Redis live state, with the existing polling as a
graceful fallback.

---

## 4. Agent architecture (spec §6, in depth)

**Principle:** many small, single-responsibility agents with typed I/O, coordinated by a Planner —
built on the pattern the repo already has in `lib/agents/orchestrate.ts` (coordinator → specialists
→ synthesizer). Two execution contexts:

- **Live loop (latency-sensitive, cheap):** Classifier → (conditionally) Project Detection,
  Action Item, Decision, Risk, Safety, Memory/RAG. Runs incrementally on turn-clusters, small
  models (Haiku-class), tight token budgets, patches live state.
- **Finalize graph (thorough, quality-first):** Planner → re-run specialists over the *full*
  transcript to consolidate/dedupe → Scheduler (due-date normalization, link to calendar/
  automations) → Minutes → QA → Memory (embed + index).

| Agent | Responsibility | In/Out |
| --- | --- | --- |
| **Planner** | Decides which specialists run for a segment/finalize; sequences the graph; owns the shared brief | state + segment → plan |
| **Conversation/Classifier** | Tags turn-clusters into the 18 categories; detects topic shifts | turns → labels |
| **Project Detection** | Sticky current-project; building/floor/area/trade/contractor/equipment/materials | turns + projects → context |
| **Action Item** | Explicit + implied assignments (owner/task/priority/due/status/confidence) | turns → items[] |
| **Decision** | Agreements (decision/reason/support/approver/timestamp/project) | turns → decisions[] |
| **Risk** | Typed risks + severity; immediate flag on high | turns → risks[] |
| **Safety** | Construction-specific safety focus (OSHA-flavored); escalates | turns → safety flags |
| **Scheduler** | Normalizes dates, links to calendar/automations, dedupes follow-ups | items → scheduled items |
| **Memory/RAG** | Retrieves referenced company knowledge; writes the searchable index | refs → documents[]; transcript → index |
| **Meeting Minutes** | Branded company-format minutes from the consolidated brief | brief → minutes markdown |
| **Quality Assurance** | Verifies completeness/dedupe/format/tone; one revision loop | minutes+brief → pass or fixes |

Each agent is a pure function `(ctx) => Promise<TypedResult>` using the existing
`generate()`/`extractJson<T>()` helpers, with its own system prompt and JSON schema, unit-testable
in isolation. Cost is controlled by (a) the Planner gating specialists and (b) model tiering
(Haiku live, Sonnet finalize).

### Orchestration framework recommendation
| Option | Fit here | Verdict |
| --- | --- | --- |
| **LangGraph (Python)** | Great graph/durability, but Python — a second runtime + IPC to our TS app | No (adds a language boundary) |
| **LangGraph.js** | Same ideas in TS; good for the finalize graph | Viable phase-2 option |
| **CrewAI** | Role-based, Python, opinionated; less deterministic control | No |
| **AutoGen** | Conversational multi-agent, Python, research-y | No |
| **Pydantic AI** | Clean typed agents — Python | No |
| **Custom TS state machine** | One language, full latency control, reuses `lib/agents`, no new infra | **Recommended** |

**Recommendation: a custom TypeScript state machine** for the live loop (deterministic, minimal
latency, already have the building blocks), with the option to adopt **LangGraph.js** later for the
finalize graph if we want durable, resumable, visually-debuggable long runs. Rationale: the entire
platform is TypeScript on the Anthropic SDK; introducing a Python framework means a second service,
serialization boundary, and duplicated auth/db access for marginal benefit. We already ship a
working coordinator/specialist/synthesizer in `lib/agents`, so we extend a proven local pattern.

---

## 5. Data model

Reuse the merged meeting tables; make the dormant ones real and add retrieval + tenancy:

- **`companies`** (multi-tenant root) — already added; scope every meeting row by `companyId`.
- **`meeting_sessions`** — add `stage`, keep `state` jsonb mirror of Redis.
- **`transcript_segments`** — add a generated `tsvector` column (`search`) + GIN index for FTS;
  **partition by month** at production scale (millions of rows).
- **`speaker_profiles`** — actually populate `embedding` (move to `vector(192/256)` via pgvector);
  `enrollmentStatus`, per-company unique voiceprint.
- **`meeting_participants`** — link `speakerLabel` → `speaker_profile`/`user`, `confidence`.
- **`meeting_events` / `_action_items` / `_decisions` / `_risks`** — already good; add
  `relatedRecordType/Id` so RAG hits and action items can point at real RFIs/submittals/etc.
- **`meeting_embeddings`** — switch `embedding` jsonb → `vector` (pgvector), `ivfflat`/`hnsw`
  index; one row per transcript chunk + per extracted item, `companyId`-scoped.
- **New `meeting_knowledge_refs`** — (meetingId, refType drawing|spec|rfi|submittal|vendor|
  equipment, refText, matchedRecordType/Id, score) for surfaced-document audit.

**Vector store decision:** **pgvector on Neon** first — one datastore, transactional, no new
vendor, fine to low-millions of vectors with HNSW. Graduate to **Qdrant/Pinecone** only if recall
latency at tens-of-millions demands it. (Keeps ops simple; matches the platform's light-dependency
posture.)

---

## 6. Technology recommendations

### Streaming STT (§3)
| Provider | Streaming | Diarization (live) | Punctuation/words | Notes |
| --- | --- | --- | --- | --- |
| **AssemblyAI** | Yes (Universal-Streaming) | Yes | Yes | **You have the key**; strong accuracy; built-in speaker labels |
| **Deepgram** | Yes (Nova-3) | Yes | Yes | Lowest latency, very cost-effective; excellent alt |
| **Speechmatics** | Yes | Yes (best-in-class real-time diarization) | Yes | Strong EU/compliance story |
| **Azure Speech** | Yes | Conversation transcription | Yes | Good if already on Azure |
| **Google STT (Chirp)** | Yes | Limited live | Yes | Ecosystem play |
| **Faster-Whisper** | Near-real-time (self-host GPU) | No native (add pyannote) | Yes | Cost control at scale; ops burden |
| **Whisper.cpp** | Chunked | No | Yes | Edge/offline fallback only |

**Recommendation:** **AssemblyAI primary** (you have it, it covers streaming + diarization +
punctuation + end-of-turn out of the box), **Deepgram as the hot-swappable secondary** (latency/
cost hedge), behind our `TranscriptionProvider` interface. **Faster-Whisper self-hosted** as a
future cost lever at very high volume.

### Diarization / Speaker-ID models (§4)
Live labels from AssemblyAI; cross-meeting identity from **pyannote.audio 3.x** or **NVIDIA NeMo
(TitaNet embeddings / Sortformer diarization)** — both current SOTA, ECAPA-TDNN-class embeddings,
run in the worker/microservice, matched via pgvector cosine.

### Full stack (§17)
| Concern | Recommendation | Why |
| --- | --- | --- |
| Desktop framework | **Electron** now (already started) + Rust audio sidecar; consider **Tauri** later | Reuse existing shell; native WASAPI without rewriting the app |
| Backend | **Next.js (Vercel)** for app/CRUD + **dedicated Node Gateway** for realtime | Stateless web vs. stateful streams |
| Audio capture | Web Audio (browser) + **WASAPI loopback via Rust `cpal`** (desktop) | Reliable separate system-audio stream |
| Streaming STT | **AssemblyAI** (Deepgram alt) | Owned key, full feature set |
| Diarization | AssemblyAI live + **pyannote/NeMo** offline | Split the two problems |
| Speaker ID | **ECAPA-TDNN embeddings + pgvector** | Standard, transactional match |
| Agent orchestration | **Custom TS state machine** (LangGraph.js optional) | One runtime, latency, reuse |
| Database | **Postgres/Neon** (+ partitioning) | Already the source of truth |
| Vector DB | **pgvector on Neon** (Qdrant later) | One datastore first |
| Caching / live state / pub-sub | **Redis (Upstash)** | Live state fan-out, gateway restarts |
| WebSockets | **Gateway WS** (or Ably/Pusher managed) | Vercel can't hold sockets |
| Document generation | **`docx`** + **Playwright→PDF** (Chromium already present) | Real Word/PDF, no heavy new dep |
| State management | Redis (server truth) + Zustand/React (client) | Clear ownership |
| Background workers | **Inngest** or **BullMQ on Redis** | Durable finalize jobs + retries |

---

## 7. Scalability & reliability (§18)

- **Stateless web tier** (Vercel) scales horizontally by default; no meeting state in-process
  (the current `Map` is deleted).
- **Gateway** scales by **sharding meetings across instances** (consistent-hash on `meetingId`);
  each instance owns N sockets; Redis holds shared live state so any dashboard replica can read it.
  Instance loss drops only its in-flight partials — finals are already persisted; clients
  auto-reconnect and the meeting resumes.
- **Finalize** runs on a **queue** (Inngest/BullMQ) with retries, idempotency keys, and a dead
  letter queue — a failed minutes run never loses the transcript and re-runs safely.
- **Data at scale:** `transcript_segments` **partitioned by month**; hot queries hit FTS/vector
  indexes; cold partitions archivable. Millions of rows is routine for partitioned Postgres.
- **Multi-tenant isolation:** every table `companyId`-scoped; queries always filtered by tenant;
  per-tenant rate limits and usage metering (the platform already meters Claude usage).
- **HA:** Neon (managed, branching/backups), Upstash (managed Redis), multi-instance Gateway
  behind a load balancer, Vercel's edge. No single-node stateful component.
- **Cost controls:** live loop uses Haiku + Planner gating; transcription is the dominant cost, so
  we support Deepgram/self-host Whisper as levers, and we default to **not** persisting raw audio.

---

## 8. Security, privacy & compliance (must-haves, not optional)

- **Consent & recording law:** many US states are two-party-consent; some jurisdictions treat
  **voiceprints as biometric data** (Illinois BIPA, GDPR Art. 9). We therefore: require explicit
  per-meeting (or durable per-user) consent to record; show a visible "recording" indicator;
  gate **voiceprint enrollment** behind separate, revocable consent; allow deletion of voiceprints
  and transcripts; document a retention policy. This is a blocking design constraint for §1/§4.
- **Data handling:** transcripts and extracted items are tenant-scoped, encrypted at rest (Neon),
  in transit (TLS/WSS). Raw audio is streamed and **not** stored by default; if stored (opt-in),
  it goes to an encrypted object store with a short TTL.
- **PII/redaction (roadmap):** optional redaction pass before minutes leave the tenant.
- **RBAC:** reuse the platform's roles; members see only their company's meetings; admins get
  oversight + audit (the audit-trail system already exists).

---

## 9. Key challenges & mitigations

1. **Serverless can't hold streams** → dedicated Gateway service (the central architectural fix).
2. **Auto-start friction & law** → detection *suggests*, user confirms; consent module.
3. **Desktop system-audio reliability** → native WASAPI sidecar, not Chromium loopback.
4. **Speaker-ID accuracy & privacy** → confidence bands + "ask once, remember"; biometric consent.
5. **Real-time cost** → model tiering, Planner gating, transcription-provider choice, no-audio-at-rest.
6. **Latency budget** (capture→STT→agents→dashboard) → keep the live loop tiny; heavy work deferred to finalize.
7. **LLM hallucination in extraction** → strict JSON, confidence scores, QA agent, "don't invent
   attendees/dates/approvals" guardrails (already the house style in `BASE_SYSTEM`).
8. **Cross-talk / overlapping speech** → separate mic/system streams; provider diarization; mark low-confidence.
9. **Electron native module maintenance** → isolate in a small versioned sidecar with a stable IPC contract.
10. **We can't inspect other apps' WebRTC** → rely on process/audio-session signals; documented limit.

---

## 10. Improvements beyond the spec

- **Close the loop with the platform:** auto-convert action items into the existing tasks/
  automations and **email drafts/sends** (we just shipped automation email); push risks to the
  **notification center**; link decisions to **change orders/RFIs**.
- **Pre-meeting context:** use Google Calendar + project detection to pre-load the likely project,
  attendees, and open RFIs before the meeting starts.
- **Confidence-gated autonomy:** only auto-create records above a confidence threshold; queue the
  rest for one-click human confirmation (mirrors the chat write-confirmation pattern).
- **Speaker analytics:** talk-time, who owns the most open items, overdue-action nudges.
- **Meeting templates:** OAC / safety toolbox / subcontractor coordination formats.
- **Edge/offline fallback:** Whisper.cpp local transcription when connectivity drops, reconciled later.
- **"Ask the meeting" chat:** a retrieval chat scoped to one meeting or across all history (reuses the main chat UI).

---

## 11. Phased roadmap

**Phase A — Foundation & correctness (in this PR, in-repo, verifiable now)**
- Fix the build (`@types/ws`, typed callbacks).
- Replace the single-prompt analyzer with the **real modular agent pipeline** (Planner + specialists
  + Minutes + QA) in `lib/meetings/agents/*`.
- **Memory** = Postgres full-text search (ranked, person/project filters) — no new dependency.
- **RAG-lite** = Memory/RAG agent retrieves from existing `project_files`/RFIs/submittals/prior
  meetings and attaches surfaced references.
- Keep browser capture + AssemblyAI streaming; document the serverless-safe path for live.

**Phase B — MVP realtime (needs the Gateway + Redis)**
- Stand up the Node Gateway (WS) + Upstash Redis; move live sessions out of the app process.
- Live agent loop + push dashboard; real `.docx`/PDF export; enrollment UI (manual mapping).
- Inngest/BullMQ finalize queue.

**Phase C — Production (speaker ID + semantic memory + scale)**
- Diarization/speaker-ID microservice (pyannote/NeMo) + pgvector voiceprints + auto-ID with
  "ask once."
- pgvector semantic memory + hybrid (FTS+vector) retrieval; transcript partitioning.
- Native WASAPI sidecar; consent/compliance module; notification/automation loop-closing.

**Phase D — Enterprise (scale-out & governance)**
- Gateway sharding + autoscale; multi-region; per-tenant retention/DLP; SSO/audit exports;
  Deepgram/self-host Whisper cost levers; analytics dashboards; macOS support.

---

## 12. Open questions for approval

1. **Realtime hosting:** OK to run the Gateway on Railway/Fly/Render (needed for true live at
   scale), or must everything stay on Vercel (then live streaming remains single-instance/demo-only)?
2. **Voiceprints:** proceed with biometric enrollment (needs a consent/compliance stance), or ship
   manual "name this speaker & remember" only for now?
3. **Semantic memory:** enable pgvector on Neon (needs the extension + an embeddings provider), or
   stay on Postgres FTS for v1?
4. **Cost posture:** default model tiers (Haiku live / Sonnet finalize) and "no raw audio at rest"
   acceptable?

Phase A is safe to implement immediately regardless of the answers above; B–D depend on them.
