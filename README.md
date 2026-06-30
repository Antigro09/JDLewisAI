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

## Roadmap (later phases)

- **Phase 2 — Google integration:** per-user OAuth for Drive/Docs/Sheets/Gmail, exposed as
  Claude tools so the AI creates/edits real files in the user's Drive (`GoogleAccount` table and
  `lib/crypto.ts` token encryption are already in place).
- **Phase 3 — Automations/routines:** natural-language automations that run indefinitely and
  connect apps (e.g. group emails → spreadsheet), via scheduled jobs / Managed Agents
  (`automations` table is scaffolded).
- **Phase 4 — Plugins & skills:** user/admin-managed skill packages and tool bundles.

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
