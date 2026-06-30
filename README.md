# ContractorAI

A private, construction-specialized AI assistant for the company, built on the Claude API.
Phase 1 MVP: per-employee accounts with one overseeing admin, projects with stored context,
streaming chat with model + effort switching, file/image/PDF context, and four
construction-specific tools (Scope of Work, Invoice review, Plan reading, Emergency Action Plan).

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind CSS**
- **Postgres** via **Drizzle ORM** (`pg` driver) — works great with Neon
- **Claude** via `@anthropic-ai/sdk` (server-side only), streaming responses
- Custom **JWT session auth** (`jose` + `bcryptjs`), RBAC (`ADMIN` / `MEMBER`)

> Note: the original plan specified Prisma. The locked-down build environment blocks Prisma's
> engine-binary download, so the data layer uses Drizzle ORM (pure TypeScript, no binary
> downloads) — a clean fit for Vercel + Neon. Everything else follows the approved plan.

## Features (Phase 1)

- **Auth & admin** — email/password sign-up & sign-in; one seeded admin; admin console to
  view/manage all accounts and see per-user AI usage/cost.
- **Chat** — streaming responses; switch between Opus 4.8 / Sonnet 4.6 / Haiku 4.5 (Fable 5
  shown as temporarily unavailable); adjustable effort (low → max); adaptive thinking display;
  attach images / PDFs / text files as context.
- **Projects** — group standing context, instructions, and files; select a project in chat to
  ground answers.
- **Personalization** — role, tone, about-you, and default model/effort folded into the prompt.
- **Scope of Work** — generate a structured scope for any of 32 trades (work included,
  exclusions, assumptions, inspections, permits, submittals, closeout). Saved + downloadable.
- **Invoices** — upload an image/PDF; AI extracts fields & line items and recommends an action;
  reviewer stamps **Approved / Needs Review / Denied** with notes and history.
- **Plan Reader** — upload a floor/electrical/structural/MEP plan; AI reads it and writes findings.
- **Emergency Action Plan** — generate a complete EAP from the company template (`templates/eap.ts`).

## Local setup

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env      # fill in DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, ANTHROPIC_API_KEY,
                          # and ADMIN_EMAIL / ADMIN_PASSWORD

# AUTH_SECRET:     openssl rand -base64 32
# ENCRYPTION_KEY:  openssl rand -base64 32   (must decode to 32 bytes)

# 3. Create the database schema (Drizzle push)
npm run db:push

# 4. Seed the admin account
npm run db:seed

# 5. Run
npm run dev
```

Open http://localhost:3000 — sign in as the admin, or employees can self-register at `/signup`.
Set `ALLOWED_SIGNUP_DOMAIN` (e.g. `yourcompany.com`) to restrict self-registration.

## Deploy (Vercel + Neon)

1. Create a Neon Postgres database; set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
2. Add all env vars from `.env.example` to the Vercel project.
3. Run `npm run db:push` (locally or via a one-off) against the Neon DB, then `npm run db:seed`.
4. Deploy. The chat route streams on the Node runtime (`maxDuration = 300`).

## Google integration (Phase 2)

Each employee connects their own Google account; the AI then searches/reads/creates/edits real
Drive files (Docs & Sheets) and reads/sends Gmail **from chat**. Read actions run automatically;
create/edit/send actions pause for one-click approval in the chat.

**Google Cloud setup (admin, one-time):**

1. Create a Google Cloud project and enable the **Drive, Docs, Sheets, and Gmail** APIs.
2. OAuth consent screen → **Internal** (Workspace org) so sensitive scopes work without app
   verification.
3. Create an **OAuth client (Web application)** with redirect URI
   `https://YOUR_APP/api/google/callback` (e.g. `http://localhost:3000/api/google/callback` in dev).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the env.

Scopes requested: Drive, Docs, Sheets, `gmail.readonly`, `gmail.send`. Tokens are stored
encrypted (`lib/crypto.ts`, AES-256-GCM) and refreshed automatically. Each user connects from
**Settings → Connect Google**.

Run `npm run db:push` after pulling Phase 2 — it adds `messages.raw_content` and
`conversations.pending_tool_uses`.

## Automations (Phase 3)

Describe a recurring task in plain language (e.g. *"every hour, find new emails labeled `bids`
and append the sender, subject, and date to the 'Bid Tracker' sheet"*). It runs unattended on a
schedule **as you**, using your Google connection and the same AI tool loop. Safety: automations
can read Gmail/Drive, create & edit Docs/Sheets, and create Gmail **drafts**, but **never send
email**.

- Manage at **Automations** in the sidebar: create, set interval (15 min / 30 min / hourly / 6 h /
  daily), enable/pause, **Run now**, and view per-run history + transcripts.
- Execution is in-app: a secured endpoint `/api/cron/run` runs due automations. Set **`CRON_SECRET`**
  and let a scheduler hit it on an interval.

**Trigger setup:**

- **Vercel Cron (Pro):** `vercel.json` already declares a `*/15 * * * *` schedule for
  `/api/cron/run`; Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. (Hobby plans
  only allow daily cron.)
- **Any plan / external:** point any scheduler (cron-job.org, GitHub Actions, …) at
  `POST https://YOUR_APP/api/cron/run` with header `Authorization: Bearer $CRON_SECRET`.

Run `npm run db:push` after pulling Phase 3 — it adds the new `automations` columns, the
`automation_runs` table, and `conversations.automation_id`.

## Skills & plugins (Phase 4)

**Skills** are reusable instruction packs (name, description, instructions) the AI follows — e.g.
"Company RFI format" or "Bid email style." Manage them under **Skills** in the sidebar:

- Personal skills (yours) and **org-wide** skills (admins publish to everyone).
- "Active by default" skills apply to every chat; a **Skills** picker in the chat header lets you
  toggle which skills apply to a given conversation.

**Plugins** are capability toggles (Settings → Plugins for your own; Admin → Plugin defaults for
org-wide defaults):

- **Google Workspace** — Drive/Docs/Sheets/Gmail tools in chat (needs Google connected).
- **Web Search** — lets the AI search the web for current info (Anthropic's server-side web
  search; off by default, small per-search cost). Resolution is user override → org default →
  built-in default. Automations honor the owner's plugin settings too.

Run `npm run db:push` after pulling Phase 4 — it adds the `skills` and `plugin_settings` tables
and `conversations.skill_ids`.

## Additional tools

Beyond the core Phase 1–4 build, the platform also includes:

- **RFIs** (`/rfis`) — generate formal Request for Information drafts and track responses to close.
- **Submittal Log** (`/submittals`) — track shop drawings / product data through review status
  (Pending, Approved, Approved as Noted, Revise & Resubmit, Rejected).
- **Change Orders** (`/changes`) — draft formal change order documents with cost/schedule impact
  and track approval status.
- **Daily Reports** (`/reports`) — turn field notes (weather, labor, work performed, issues) into a
  formatted daily site report.
- **Bid Comparison** (`/bids`) — compare 2+ vendor quotes side by side with AI analysis and a
  recommendation.
- **Project Knowledge Search** (`/search`) — ask questions across all text-based files attached to
  your projects; answers are grounded only in your uploaded content.
- **Field Capture** (`/capture`) — mobile-optimized camera capture (`capture="environment"`) for
  photographing a plan or invoice directly from the job site and analyzing it on the spot.
- **Admin cost dashboard** — `/admin` now shows total spend, total tokens, automation run counts,
  and a cost-by-feature breakdown in addition to per-user usage.

## Roadmap

- ~~**Phase 2 — Google**~~ · ~~**Phase 3 — Automations**~~ · ~~**Phase 4 — Skills & plugins**~~ — all done.
- ~~RFI/submittal/change-order generators, bid comparison, project-knowledge RAG, richer admin
  cost dashboard, mobile field capture~~ — all done.

## Project layout

```
app/(auth)        sign-in / sign-up
app/(app)         authenticated shell: chat, projects, scopes, invoices, plans, eap, settings, admin
app/api/chat      streaming chat endpoint
lib/claude        Anthropic client, model registry, effort, streaming, generation
lib/tools         construction generators (scope, invoice, plan, eap) + trade list
lib/db            Drizzle schema + client + seed
lib/auth          password hashing, JWT session, RBAC helpers
components         UI primitives, sidebar, chat, markdown, status badges
templates         Emergency Action Plan template
```
