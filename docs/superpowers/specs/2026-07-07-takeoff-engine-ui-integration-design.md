# Material Takeoff → Engine Front-End — Design Spec

**Date:** 2026-07-07
**Status:** Approved design, ready for implementation planning
**Owner:** contractor-ai (Next.js app) + takeoff-engine (Python/FastAPI)

## 1. Goal & context

Replace the app's current Claude-vision Material Takeoff page (`app/(app)/material-takeoff/`) with a front-end for the Python **takeoff-engine** (`takeoff-engine/`), delivering the engine's full review workflow (overlay viewer + per-quantity accept/edit/reject + two-click scale calibration + corrections stored as training data) inside the app's design system, and bridging the engine's reviewed quantities into the app's existing assembly/pricing layer to produce CSI material lines.

The engine measures from vector geometry + OCR + detection + segmentation + deterministic Shapely geometry; its rule is *measurements never come from an LLM*. This integration makes the app the front door to that engine and reuses the app's deterministic `ASSEMBLIES` registry for the quantities→materials→pricing step.

### Locked product decisions
1. **Replace** the existing page. Drop the Claude-vision extraction path; **keep and reuse** the deterministic downstream in `lib/tools/material-takeoff.ts`.
2. **Full review workflow**: overlays, accept/edit/reject, two-click calibration, corrections as training data.
3. **Materials bridge**: reviewed/accepted engine quantities flow through the app's `ASSEMBLIES` → CSI material lines + pricing.
4. Route path `/material-takeoff` is unchanged (command-palette link and deep links keep working).

## 2. Architecture

Three server-side layers plus a client workspace.

**(1) Engine client — `lib/takeoff-engine/client.ts` (server-only).**
Base URL = `env.TAKEOFF_ENGINE_URL ?? "http://localhost:8000"` (never `NEXT_PUBLIC`). `engineFetch(path, init)` wraps `fetch` with `cache: "no-store"` and `AbortSignal.timeout` (~15s JSON, ~120s upload/stream), normalizing failures into typed errors: `EngineDownError` (network/abort/ECONNREFUSED/unset-in-prod), `EngineHttpError(status, body)` for non-2xx (echoing 404/410/415/422), `EngineTimeoutError`. Typed helpers: `createProject`, `uploadFile`, `startProcess`, `getJob`, `listSheets`, `getSheetImage` (returns raw `Response` for streaming), `getOverlay`, `listQuantities`, `getQuantity`, `reviewQuantity`, `calibrate`, `listCorrections`, `createExportAndDownload`.

**(2) Ownership guards — `lib/takeoff-engine/auth.ts`.**
The engine has no auth and global object ids, so `takeoff_projects` is the **sole** tenant boundary.
- `requireTakeoff(takeoffId)`: `user = await requireUser()`; `SELECT takeoff_projects WHERE id = takeoffId AND userId = user.id`; on miss **throw NotFound → route returns 404** (never 403 — no existence leak); returns `{ user, row }`.
- `assertSheetInProject(epid, sheetId)`: `listSheets(epid)`, 404 unless present.
- `assertQuantityInProject(epid, quantityId)`: `getQuantity(quantityId)`, 404 unless `.project_id === epid` (verified: `QuantityItem.project_id` is in the engine's `model_dump`).
- `assertJobInProject(epid, jobId)`: `getJob(jobId).project_id === epid`.

**(3) Materials bridge — `lib/takeoff-engine/bridge.ts`.**
Converts reviewed engine quantities into the app `Measurement` shape and delegates to the **kept** pipeline through a newly-exported `buildReportFromMeasurements(measurements, { sheets, scope?, assemblyOverrides?, issues? })` which runs `measurements.flatMap(m => runAssembly(m, overrides, issues))` → `organizeReport(mergeLines(lines))` → `TakeoffReport`. All pure math stays in `lib/tools/material-takeoff.ts`.

**Route handlers** (`app/api/takeoff/**`): each declares `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`, types params as `{ params: Promise<{...}> }` (Next 15), authorizes ownership FIRST, re-scopes child ids, then proxies.

**Client**: a `"use client"` state machine (`idle → creating → uploading → processing(poll) → review → bridged`, each with an error variant) composing the overlay viewer, review queue, and materials preview via hooks; reuses the existing `Division → Trade → MaterialRows` tables verbatim to render the bridged report.

## 3. Security / ownership model

Because engine ids are global and guessable and the engine trusts anyone who can reach it:
- Every route calls `requireTakeoff` first, then re-scopes any sheet/quantity/job id to the authorized `engineProjectId` before forwarding. A crafted or path-injected id fails id-equality and 404s **before** `engineFetch`.
- **Export is a single authorized create+stream handler** (`POST /export` → immediately `GET /exports/{eid}/download`, passing through `Content-Type`/`Content-Disposition`). There is deliberately **no** standalone `/exports/[eid]/download` route, because the engine's download endpoint ignores `project_id` — folding create+download into one ownership-checked call eliminates the IDOR on a guessable `eid`.
- `TAKEOFF_ENGINE_URL` is server-only and **must** point at a private-network/localhost engine. A publicly reachable engine URL is a direct data-exposure risk.

## 4. Proxy layer — route inventory

All under `app/api/takeoff/**` (`runtime: "nodejs"`, `dynamic: "force-dynamic"`).

- `POST /api/takeoff` `{name}` — `requireUser` → `createProject` → **only on 201** INSERT `takeoff_projects{userId, engineProjectId, name, status:"created"}`; if engine down, 503 and insert nothing (no orphan). `GET` — list caller's rows (WHERE userId).
- `GET /api/takeoff/[takeoffId]` — `requireTakeoff` → optional engine project detail. Optional `DELETE` removes the ownership row.
- `POST /api/takeoff/[takeoffId]/files` — `requireTakeoff`; read `req.formData()`, take `file`; **ACCEPT** if `file.type ∈ {application/pdf, image/tiff, image/tif}` OR (`file.type` is `""`/`application/octet-stream` AND filename matches `/\.(pdf|tif|tiff)$/i`) — mirrors the engine's content-type-OR-extension rule so legitimate TIFFs (browsers often report `type=""`) aren't falsely 415'd; png/jpeg/webp stay **415**. **Explicit size guard** → 413 if `Content-Length`/byte count exceeds a configured cap (`serverActions.bodySizeLimit` and `middlewareClientMaxBodySize` do **not** govern `/api` route handlers). Rebuild a fresh `FormData` preserving original filename+type; forward via `uploadFile` (do not hand-set `Content-Type` — let `fetch` set the multipart boundary). Pass engine 415 through.
- `POST /api/takeoff/[takeoffId]/process` — `requireTakeoff`; **atomic double-submit guard**: `UPDATE takeoff_projects SET status='processing', engineJobId=? WHERE id=? AND status <> 'processing' RETURNING *` — only call `startProcess` when a row was updated, else 409. Persist `engineJobId, jobStatus:"queued", jobProgress:"", jobError:null, processStartedAt: now`.
- `GET /api/takeoff/[takeoffId]/status` — `requireTakeoff`; if no `engineJobId` → `{status:"created"}`; else `getJob(jobId)`. On `EngineDownError` return 200 `{engineDown:true, status:last-known}` (poller backs off, does NOT mark failed). Map engine **job** status → app status: `done→"review"`, `failed→"failed"`, `queued/running→"processing"`. Forward-only CAS (never overwrite `"review"`/`"failed"` with a stale `"running"`). On reload/resume when the job lookup fails, fall back to engine **project** status with an explicit map: `processed→"review"`, `failed→"failed"`, `processing→"processing"`, `created→"created"`, unknown → last-known + stalled detection. Persist free-text `jobProgress`, `jobStatus`, `lastPolledAt`. Compute `stalled = jobStatus ∈ {queued,running} AND now − processStartedAt > threshold`. Return `{status, jobStatus, progress, error, engineDown, stalled}`.
- `GET /api/takeoff/[takeoffId]/sheets` — `requireTakeoff` → `listSheets`.
- `GET /api/takeoff/[takeoffId]/sheets/[sheetId]/image` — `requireTakeoff` + `assertSheetInProject`; `r = getSheetImage(sid)`; `return new Response(r.body, { status: r.status, headers: { "Content-Type":"image/png", "Cache-Control":"private, max-age=300" } })`. Streams the PNG so `<img src>` stays same-origin under `img-src 'self'`; propagate 404/410 (missing render) so the client shows a placeholder.
- `GET /api/takeoff/[takeoffId]/sheets/[sheetId]/overlay` — `requireTakeoff` + `assertSheetInProject` → `getOverlay` (page-point geometry unchanged).
- `POST /api/takeoff/[takeoffId]/sheets/[sheetId]/calibrate` `{p1,p2,real_distance_ft}` — `requireTakeoff` + `assertSheetInProject`; validate `p1`/`p2` are `[number,number]` and `real_distance_ft > 0` → `calibrate` → `{scale_id, ft_per_pt}`. Client then re-POSTs `/process`.
- `GET /api/takeoff/[takeoffId]/quantities` — `requireTakeoff` → `listQuantities` forwarding `needs_review` & `item_type` query params.
- `POST /api/takeoff/[takeoffId]/quantities/[qid]/review` `{action, corrected_*, comment}` — `requireTakeoff` + `assertQuantityInProject`; if `action==="edit"` && `corrected_quantity == null` → 422 before forwarding; **reviewer stamped server-side** from `user.name`/`email` (never trust client) → `reviewQuantity`; pass engine 422 through.
- `POST /api/takeoff/[takeoffId]/bridge` `{includeHighConfidence?, assemblyOverrides?, exportSheet?}` — see §8.
- `GET /api/takeoff/[takeoffId]/corrections` — `requireTakeoff` → `listCorrections` (training log; also consumed by the bridge for reconciliation).
- `POST /api/takeoff/[takeoffId]/export` `{format}` — `requireTakeoff` → `createExportAndDownload(epid, format)` (single authorized create+stream; no standalone download route).

## 5. Async job flow

Client hook `use-takeoff-job.ts`: a **self-scheduling `setTimeout` loop** (never `setInterval`) with exponential backoff (1s→2s→5s cap), a **monotonic poll token + per-request `AbortController`** (responses from a superseded job after re-process are discarded), an in-flight guard, and forward-only local status. Polls `GET /status`.

Happy path: create (`?t=<takeoffId>` in URL for refresh-resume) → sequential `POST /files` per file → `POST /process` → poll `/status`. Engine `JobRow.progress` is a `String(255)` free-text stage (e.g. `"A-101: sheet 2/5"`), **not** a percent — render it verbatim and derive a coarse bar from `jobStatus` (queued~10 / running~60 / done 100 / failed=error); no numeric progress column, no `NaN` bar. Terminal: `done` → load `/sheets`, first sheet's `/overlay` + `<img src=/sheets/[sid]/image>`, `/quantities?needs_review=true`; `failed` → engine error + Re-run; `engineDown` → pause+backoff; `stalled` → banner + Re-check/Re-process.

Resume after reload: row persists `engineJobId` + `status`; on mount if `status==="processing"` the hook resumes polling; `/status` falls back to engine project status when the job lookup fails (the in-process engine queue does not recover a job orphaned by an engine restart — hence the stalled escape).

Idempotency: the engine's content-stable `_stable_id` upserts make re-measure idempotent (no double-count). Calibrate → re-process keeps the manual scale across runs.

## 6. Data model & migration

Add to `lib/db/schema.ts` (uses existing `id()` helper, `references(() => users.id, { onDelete: "cascade" })`, `index`/`uniqueIndex`, `$type<>()`). `jobProgress` is **TEXT** (engine reports a free-text stage label).

```ts
export type TakeoffStatus = "created" | "uploading" | "processing" | "review" | "failed";
export type EngineJobStatus = "queued" | "running" | "done" | "failed";

export const takeoffProjects = pgTable("takeoff_projects", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  engineProjectId: text("engine_project_id").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<TakeoffStatus>().notNull().default("created"),
  engineJobId: text("engine_job_id"),
  jobStatus: text("job_status").$type<EngineJobStatus>(),
  jobProgress: text("job_progress").notNull().default(""),
  jobError: text("job_error"),
  processStartedAt: timestamp("process_started_at"),
  lastPolledAt: timestamp("last_polled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("takeoff_projects_user_id_idx").on(t.userId),
  engineProjectUnique: uniqueIndex("takeoff_projects_engine_project_id_key").on(t.engineProjectId),
}));
export type TakeoffProject = typeof takeoffProjects.$inferSelect;
```

Migration: `npm run db:generate` (writes `drizzle/0002_*.sql` + `drizzle/meta/0002_snapshot.json`, appends `_journal.json` — do not hand-edit meta), then `npm run db:migrate` (dev: `npm run db:push`). Next number is `0002` (only `0000_init`, `0001_batch2` exist). **Additive only** — one `CREATE TABLE` + FK + one index + one unique index; no `ALTER`/`DROP`, no backfill; reversible and safe on a live DB.

## 7. Overlay / review client

Three-pane workspace under `PageShell`: left sheet rail (thumbnails + `needs_review` counts), center overlay viewer, right column stacking review queue over materials preview. Pure transforms live in `app/(app)/material-takeoff/coords.ts` (React-free, unit-tested).

**Coordinate systems.** (a) PAGE POINTS: overlay geometry, top-left origin, x-right/y-down, 1/72 in; overlay payload supplies `width_pt`, `height_pt` (source of truth, already bakes in `rotation_deg`). (b) IMAGE PIXELS: PNG at `render_dpi` (default 150; TIFF may use 300) so `naturalWidth = round(width_pt * dpi/72)` — DPI is **not** hardcoded in load-bearing math. (c) DISPLAYED/CSS PIXELS: `rect = img.getBoundingClientRect()`.

**Congruent container (prevents overlay/click drift):** a positioned wrapper with CSS `aspect-ratio: {width_pt} / {height_pt}`; both `<img>` and `<svg>` are `position:absolute; inset:0; width:100%; height:100%`. The PNG's natural aspect equals `width_pt:height_pt`, so no letterboxing.

**Render (points → displayed, zero per-point JS):** `<svg viewBox="0 0 {width_pt} {height_pt}" preserveAspectRatio="xMidYMid meet">`. `feature.polygons` is a **list of rings** — emit one `<polygon>` per ring (a single points-string misdraws multi-region features). Boxes `[x0,y0,x1,y1]` → `<rect x=x0 y=y0 width=x1-x0 height=y1-y0>`. Color from `feature.style`; `needs_review` = dashed amber, accepted = green, edited = amber, rejected = hidden/strikethrough. Features with empty polygons **and** boxes still get a queue row (not every feature is a clickable shape).

**Transform formulas.** Let `K = rect.width / width_pt` (= `rect.height / height_pt`; displayed px per page-point, derived from the rect so DPI and `devicePixelRatio` cancel — never assume 150).
- Forward (page point → displayed CSS px, for HTML badges): `screenX = rect.left + x_pt * (rect.width / width_pt)`, `screenY = rect.top + y_pt * (rect.height / height_pt)`.
- Inverse (pointer → page point, for calibration + hit-testing): `x_pt = (clientX − rect.left) * (width_pt / rect.width)`, `y_pt = (clientY − rect.top) * (height_pt / rect.height)`.
- DPI-cancellation is proven by a round-trip test asserting `inverse(forward(p)) == p` within epsilon at several rect sizes and a non-1:1 aspect.

**Two-click calibration:** user enters the known real distance (ft); crosshair cursor; two image clicks → both converted displayed→page-points via the inverse formula; `POST {p1, p2, real_distance_ft}` (engine computes `ft_per_pt = real_distance_ft / hypot(Δpt)`, matching `manual_calibration`). Live readout while placing the 2nd point uses `overlay.scale.ft_per_pt` **if present**; on NTS/no-scale sheets (the primary calibration target) that is null, so show the entered `real_distance_ft` as the target span labeled "no current scale" (never `NaN`). Confirm → `POST /calibrate` → auto `POST /process` → re-poll.

**Review UX:** triage list from `GET /quantities?needs_review=true` (+ `item_type` filter), sorted needs-review-first then ascending `final_confidence`; rows show description/quantity/unit, `review_reason` chips (`nts_sheet`, `no_reliable_scale`, `low_confidence`, `multi_thickness`, `open_polygon`, `implausible_measurement`) and a confidence meter. Inline Accept / Edit (numeric `corrected_quantity` **required** — Save disabled until entered; optional unit/description) / Reject, plus keyboard `A/E/R`, `[ ]` step, `F` fit, `+/−` zoom, `C` calibrate. "Accept all high-confidence" bulk action. Overlay↔row cross-highlight. Scale reasons deep-link into calibrate mode.

## 8. Materials bridge

`lib/takeoff-engine/bridge.ts` converts reviewed engine quantities into the app `Measurement` shape and delegates via `buildReportFromMeasurements`. The engine already produced a computed quantity in a canonical unit, so the bridge builds `Measurement` **directly** (it does NOT call `normalizeMeasurement`, whose dimension-string paths are for the deleted LLM flow).

**Review reconciliation (source of truth).** Fetch `GET /projects/{epid}/corrections` and build a map of the latest decision per physical item. A calibrate→re-process cycle re-merges every `QuantityRow.review_status` back to `pending`, so the live status is **not trusted alone**. **Reconcile by geometry, not id** (engine `_stable_id` is a positional index — neural-detector reordering can silently reassign an id): match each corrections-log decision's `machine_snapshot` (which includes `source_geometry_ids`, `sheet_id`, `quantity`) to the current item by nearest polygon centroid / area within epsilon on the same sheet; fall back to id only on an exact geometric match; flag ambiguous matches for re-review rather than applying them. Effective status = reconciled decision if present, else the row's `review_status`. A UI note states decisions are preserved via the corrections log.

**Inclusion policy (reproduces "show 100%").** Include a quantity when effective status is `accepted` OR `edited`, OR (`needs_review === false` AND effective status ≠ `rejected`). High-confidence, non-flagged items flow through automatically; flagged/needs-review items require a human decision. `edit`'s `corrected_quantity` overrides the engine quantity.

**Unit → MeasurementKind + canonical unit** (`KIND_UNIT`: count→EA, length→LF, area→SF, volume→CY): `EA→count/EA` (`Math.round`), `LF→length/LF`, `SF→area/SF`, `SY→area/SF` (`× 9`), `CY→volume/CY`.

**Item map** (keyed by `item_type`; kind from unit):

| engine item_type | unit | Trade | kind | assemblyId | notes |
|---|---|---|---|---|---|
| `concrete_slab` | CY | concrete | volume | `concrete-slab` | **Primary.** Pass slab area per-measurement (see fix below), not via global overrides. Route to `issues` instead of emitting lines when `needs_review` OR `quantity===0` OR reason ∈ {`no_reliable_scale`,`nts_sheet`,`multi_thickness`} (unmeasured slab → flag, never a 0-CY line). |
| `concrete_slab` | SF | concrete | area | raw | rare post-rollup; ambiguous thickness → issue + raw. |
| `flooring` | SF | flooring | area | `vct-flooring` | Use `attributes.base_sqft` (PRE-waste) as the quantity — the engine's `derive_flooring` already applied `waste_factor` (~1.10); feeding waste-inclusive SF into `vct-flooring` (wastePct 10) double-counts ~21%. Flag "VCT assumed — override if carpet/tile". |
| `flooring` | SY | flooring | area | `vct-flooring` | `base_sqft` path; `× 9` if raw SY. |
| `room` | SF | flooring | area | `vct-flooring` | defensive alias. |
| `door` | EA | doors_windows | count | raw | per-EA buyable line (CSI Div 08); not flagged ambiguous. |
| `window` | EA | doors_windows | count | raw | per-EA line (Div 08). |
| `wall` | LF | framing | length | `metal-stud-wall` | forward-ready; **dormant** (detector detects walls but the engine does not yet emit wall quantities). |
| `slab` | SF/CY | concrete | area/volume | `concrete-slab` | defensive raw-label alias. |
| *anything else* | any | general | by unit | raw | **UNMAPPED pass-through**: `trade:"general"`, `assemblyId: undefined`; `runAssembly`'s no-match branch emits a raw line + "No assembly matched"; push a `TakeoffIssue` warning. Nothing is ever dropped (parity with today's 100%). |

**Measurement construction** per included quantity: `{ kind, quantity (with SY×9 / base_sqft applied), unit (canonical), trade + assemblyId from table, assemblyParams (see fix), label: q.description, sheetRef: `${sheet.sheet_number||q.sheet_id} p.${q.page_number}`, basis: `${q.formula} [engine ${q.item_type} ${q.unit}, ${effectiveStatus}, conf ${q.final_confidence}]`, source: effectiveStatus==="edited" ? "schedule" : "traced", assumptions: [...review_reason texts, ambiguity flags] }`. Then `buildReportFromMeasurements` → `runAssembly` → `mergeLines` (single ceil after summing) → `organizeReport`; `applyPricing(report, rateTable)` only when a rate table exists (default none = quantities-only, matching today). `recordUsage({ userId, model:"takeoff-engine", feature:"material_takeoff", inputTokens:0, outputTokens:0 })` keeps the metering call site alive (cost 0 for the unknown model; `recordUsage` swallows its own errors).

**Per-measurement assembly params (correctness fix).** `runAssembly` currently builds params as `{...asm.defaults, ...overrides[asm.id]}` — a single map keyed by assembly id, shared across every measurement, so a multi-slab project can carry only one `slabSf`. **Fix:** add an optional `Measurement.assemblyParams?: Record<string, number>` and merge it **after** defaults and overrides: `const params = { ...asm.defaults, ...(overrides[asm.id] ?? {}), ...(m.assemblyParams ?? {}) }`. The bridge sets `m.assemblyParams = { slabSf: attributes.sqft }` on each `concrete_slab` item individually, so mesh/vapor-barrier use each slab's true area instead of the 4-in 81-SF/CY back-derivation. Add an optional `slabSf` param to the `concrete-slab` assembly (defaults to `cy * 81` so behavior is unchanged when absent).

## 9. Config / env

Add to `lib/env.ts`: in the zod schema `TAKEOFF_ENGINE_URL: z.string().url().optional()`; in the raw map `TAKEOFF_ENGINE_URL: clean(process.env.TAKEOFF_ENGINE_URL)`. Kept **optional** so `next build` (which imports route modules without secrets) does not fail; the runtime default `http://localhost:8000` lives only in `client.ts`, which throws `EngineDownError` (→ 503) if the var is unset in production rather than silently calling localhost. Server-only (never `NEXT_PUBLIC`). Add `TAKEOFF_ENGINE_URL=http://localhost:8000` to `.env.example` with a comment that the engine is a separate no-auth FastAPI service and this must be set in every environment (dev + EC2). **No CSP change** — everything is same-origin through the proxy.

## 10. Error handling (typed failure states)

Union: `engine_down | job_failed | stalled | render_missing | unsupported_type | not_found | edit_missing_quantity`.
- **Engine down** → JSON routes 502/503; `/status` returns 200 `{engineDown:true, status:last-known}` so the poller pauses+backs off; dismissible retry banner; rest of app unaffected.
- **Job failed** → `row.status="failed"`, `jobError` persisted; stop polling; show engine error verbatim + Re-run; "Calibrate a sheet" CTA when the error implies scale.
- **Stalled / never-finishing** → `processStartedAt` + wall-clock threshold; hard client poll timeout → banner with Re-check + Re-process.
- **NTS / no reliable scale** → quantities arrive `needs_review` with reason `nts_sheet`/`no_reliable_scale` and "unmeasured" formulas; excluded by the inclusion policy; unmeasured slabs routed to issues (never a 0-CY line); triage surfaces them first, deep-links to calibrate.
- **Unsupported upload** → `/files` 415 (client `accept="application/pdf,image/tiff,.pdf,.tif,.tiff"` + per-file reasons); engine 415 passed through.
- **Oversize upload** → explicit byte-count guard → 413.
- **Missing render image** → engine 404/410 forwarded; viewer shows "render unavailable — re-process" placeholder, disables overlay/calibrate for that sheet.
- **Edit without corrected_quantity** → client disables Save; review route 422s before forwarding.
- **Cross-tenant id** → 404 (no existence leak); export is create+download in one authorized handler.
- **Metering** → `recordUsage` swallows/logs its own errors and cost is 0, so a costing miss never breaks the response.

## 11. Testing plan

The repo has a real **vitest** harness (`vitest.config.ts`, `package.json` `test: vitest run`, `tests/setup.ts`, existing suites). `npm test` is a required gate.

**Unit (pure):**
- `bridge.ts` (table-driven): `concrete_slab` CY → `concrete-slab` with **per-measurement** `slabSf` (assert mesh/VB use `attributes.sqft`, not `cy*81`, for a 6-in slab, **and** that two slabs each use their own area); `concrete_slab` `needs_review`/`quantity===0` → issue, no 0-CY line; `flooring` SF → `vct-flooring` fed `base_sqft` (assert no ~21% double-waste); `flooring` SY → `× 9`; door/window EA → single raw Div-08 EA line; unmapped → general raw + one warning; inclusion policy includes accepted/edited + non-flagged high-confidence, excludes rejected/flagged-pending; **geometry-based** corrections reconciliation overrides a re-processed `pending` back to accepted with its `corrected_quantity`, and flags an ambiguous geometric match instead of misapplying it.
- `coords.ts`: `inverse(forward(p))` round-trips within epsilon at several rect sizes and a non-1:1 aspect; assert `render_dpi` never appears in the transform; a known 24-ft dimension over N points reproduces the engine's `ft_per_pt`.
- `material-takeoff.ts`: a fixed `Measurement` set through `buildReportFromMeasurements` reproduces prior division/line output (guards the refactor + the new `slabSf` default = `cy*81` when absent).
- `auth.ts` guards: `requireTakeoff` rejects another user's `takeoffId`; `assertSheet/Quantity/Job` reject foreign ids → all 404.

**Route/integration (engine mocked via msw/nock):** every proxy calls `requireUser` + `requireTakeoff` before forwarding; `/files` 415s `image/png` but ACCEPTS a `.tif` with `file.type=""`; `/files` 413s oversize; image route returns `Content-Type: image/png` and streams the body; `/status` maps job `done→"review"` and pauses (not fails) on `engineDown`; `/process` atomic guard 409s a concurrent submit; export is a single authorized create+download call.

**Build/type gates:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` all pass after deleting the LLM path (grep-confirmed importers are only the rewritten material-takeoff files).

**Manual E2E** (engine on `:8000`, mock adapters deterministic): create → upload PDF/TIFF → process → watch the progress string → triage `needs_review` → two-click calibrate an NTS sheet → re-process → accept + bulk-accept → watch materials-preview recompute → export xlsx same-origin. Verify DevTools shows no blocked `connect-src`/`img-src`. Authorization: two users, user B gets 404 (not 403) on user A's `takeoffId` and on a foreign `sid`/`qid` under B's own `takeoffId`.

## 12. Rollout / migration sequence

1. Land the additive schema + migration `0002` first (`CREATE TABLE` only, safe on a live DB, deployable independently).
2. Add `TAKEOFF_ENGINE_URL` to env config in every environment before the app code that reads it (optional in zod so a build without it still succeeds; set it in dev + EC2 pointing at the private engine).
3. Deploy the engine (separate FastAPI service, own DB) reachable only on the private network/localhost.
4. Ship the app change: delete the LLM path in `lib/tools/material-takeoff.ts` (`extractSheetMeasurements`, `runMaterialTakeoff`, `EXTRACTION_*`, `nullable`, `SheetExtraction`, `RawSheet`, `TakeoffFile`, `ALLOWED_MIMES`, `MAX_FILE_BYTES`, and the `@/lib/claude/chat` + `@/lib/claude/models` imports); **export** `mergeLines`/`organizeReport`/`DEFAULT_ASSEMBLY`; add `buildReportFromMeasurements`; add the optional per-measurement `assemblyParams` merge in `runAssembly` and the optional `slabSf` param on `concrete-slab`. Rewrite `actions.ts` to thin create/export server actions (re-home the Google-Sheet export using the bridged report + existing `isGoogleConnected`/`sheetsCreate`; delete `runPlanTakeoffAction`). Rewrite `page.tsx` (list the user's takeoffs) and the client into the review workspace; add the route handlers, engine client, auth guards, bridge, coords, hooks, and the three review components.

Route path unchanged → command-palette link and deep links keep working; no data migration (the old page persisted no takeoff rows). Rollback: revert the app deploy; the `takeoff_projects` table can remain (additive) or be dropped separately. Optional feature flag to gate the new client if the engine isn't provisioned yet. **Metering semantics change** (real Anthropic token cost → 0-cost `material_takeoff` events); confirm with billing/analytics owners, or plan a per-processed-sheet counter (needs a `usage_events` metadata column — out of scope here).

## 13. Files touched

**Create**
- `lib/takeoff-engine/client.ts`, `auth.ts`, `bridge.ts`, `types.ts`
- `app/api/takeoff/route.ts`
- `app/api/takeoff/[takeoffId]/route.ts`
- `app/api/takeoff/[takeoffId]/files/route.ts`
- `app/api/takeoff/[takeoffId]/process/route.ts`
- `app/api/takeoff/[takeoffId]/status/route.ts`
- `app/api/takeoff/[takeoffId]/sheets/route.ts`
- `app/api/takeoff/[takeoffId]/sheets/[sheetId]/image/route.ts`
- `app/api/takeoff/[takeoffId]/sheets/[sheetId]/overlay/route.ts`
- `app/api/takeoff/[takeoffId]/sheets/[sheetId]/calibrate/route.ts`
- `app/api/takeoff/[takeoffId]/quantities/route.ts`
- `app/api/takeoff/[takeoffId]/quantities/[qid]/review/route.ts`
- `app/api/takeoff/[takeoffId]/bridge/route.ts`
- `app/api/takeoff/[takeoffId]/corrections/route.ts`
- `app/api/takeoff/[takeoffId]/export/route.ts`
- `app/(app)/material-takeoff/coords.ts`, `use-takeoff-job.ts`, `overlay-viewer.tsx`, `review-queue.tsx`, `materials-preview.tsx`
- `drizzle/0002_takeoff_projects.sql` (generated)

**Modify**
- `lib/db/schema.ts` (add `takeoffProjects` + types)
- `lib/env.ts` (add optional `TAKEOFF_ENGINE_URL`)
- `lib/tools/material-takeoff.ts` (delete LLM path; export `mergeLines`/`organizeReport`/`DEFAULT_ASSEMBLY`; add `buildReportFromMeasurements`; per-measurement `assemblyParams`; optional `slabSf`)
- `app/(app)/material-takeoff/actions.ts` (thin create + Google-Sheet export from bridged report; delete `runPlanTakeoffAction`)
- `app/(app)/material-takeoff/page.tsx` (list user's takeoffs; render workspace)
- `app/(app)/material-takeoff/material-takeoff-client.tsx` (rewrite into the async submit+poll+review state machine; reuse existing report tables)
- `.env.example` (document `TAKEOFF_ENGINE_URL`)

## 14. Risks & open questions

- `takeoff_projects` is the **only** tenant boundary; every route must prove ownership AND re-scope child ids, or it is an IDOR/SSRF into another tenant. `TAKEOFF_ENGINE_URL` must stay server-only and private.
- Review reconciliation depends on matching corrections-log decisions to current items **by geometry**; verify `GET /corrections` returns enough (`machine_snapshot` with `source_geometry_ids`/geometry) to reconstruct effective status after a re-process. If geometric match is ambiguous, flag for re-review rather than misapply. (Engine-side alternative: make `_stable_id` geometry-derived.)
- Ownership guards add an engine round-trip per sheet/quantity request; acceptable for correctness — consider a short per-request cache of the project's sheet-id set if the engine is slow.
- Create-then-insert is not atomic: an engine 201 followed by an app insert failure leaves an orphan engine project (low harm; note a periodic reconcile/cleanup).
- **MVP engine emits only `concrete_slab`/`flooring`/`door`/`window`** (wall detected but not emitted), so framing/drywall/paint/plumbing produce nothing until the detector is fine-tuned — the page looks sparse vs the old LLM path; set expectations in UI copy. The framing→`metal-stud-wall` mapping is forward-ready but dormant.
- Metering changes from real Anthropic token cost to 0-cost events; engine GPU compute is unmetered at the app layer. Confirm acceptable or plan a per-processed-sheet counter.
- Calibrate requires a **full project re-process** (no targeted re-measure); latency grows with project size — the stalled/progress UX must set expectations.
- `render_dpi` is engine-configurable (150 default, TIFF may be 300); the transform derives `K` from `rect.width/width_pt` so it is DPI-safe — never assume `naturalWidth == width_pt*150/72`.
- `Sheet.rotation_deg != 0`: overlays align only if the engine renders the PNG in the orientation the overlay points assume (engine handles rotation server-side) — verify against a rotated sheet before shipping.
- Large multi-page TIFF/PDF near the size cap: `/files` buffers via `req.formData()`; the explicit size guard bounds it, but the real deployment limit (ALB/nginx) is unverified — load-test the largest expected single file; consider streaming passthrough (`req.body` + `duplex:"half"`).

## 15. Adversarial-review corrections (incorporated above)

The design was stress-tested by an independent reviewer; these four are already folded into the relevant sections:
1. **High** — per-slab concrete area cannot travel through the shared `assemblyOverrides` map → **per-`Measurement.assemblyParams`** merged in `runAssembly` (§8).
2. **Medium** — corrections reconciliation by positional id is fragile under detector reordering → **reconcile by geometry**, flag ambiguous matches (§8, §14).
3. **Low** — engine `processed` project status had no app mapping → explicit `processed→"review"` fallback (§4/§5).
4. **Low** — non-atomic double-submit guard → **atomic conditional UPDATE** on `/process` (§4).
