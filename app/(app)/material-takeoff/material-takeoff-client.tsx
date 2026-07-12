"use client";

import { FileUp, Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Badge, Button, Input, Label, Spinner, Textarea } from "@/components/ui";
import type { EngineJobStatus, TakeoffStatus } from "@/lib/db/schema";
import type {
  EngineOverlay,
  EngineQuantity,
  EngineSheet,
  ReviewAction,
  TakeoffScope,
} from "@/lib/takeoff-engine/types";
import type { TakeoffReport } from "@/lib/tools/material-takeoff";
import { nextAutoAcceptTarget, readAutoAcceptSetting, writeAutoAcceptSetting } from "./auto-accept";
import { MaterialsPreview } from "./materials-preview";
import { OverlayViewer } from "./overlay-viewer";
import { ReviewQueue } from "./review-queue";
import { useTakeoffJob } from "./use-takeoff-job";

export type TakeoffListItem = {
  id: string;
  name: string;
  status: TakeoffStatus;
  engineJobId: string | null;
  jobStatus: EngineJobStatus | null;
  jobProgress: string;
  jobError: string | null;
  takeoffInstructions: string;
  takeoffScope: unknown;
  processStartedAt: string | null;
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type JsonResponse<T> = T & { error?: string; message?: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as JsonResponse<T>;
  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

function statusTone(status: TakeoffStatus): string {
  if (status === "review") return "bg-ember-success-bg text-ember-success";
  if (status === "indexed") return "bg-ember-warning-bg text-ember-warning";
  if (status === "failed") return "bg-ember-danger-bg text-ember-danger";
  if (status === "processing" || status === "indexing") {
    return "bg-ember-tint text-ember-tint-text";
  }
  return "bg-ember-pill text-ember-muted";
}

function coarseProgress(status: TakeoffStatus, jobStatus?: EngineJobStatus | null): number {
  if (status === "review") return 100;
  if (status === "indexed") return 100;
  if (status === "failed") return 100;
  if (jobStatus === "running") return 60;
  if (jobStatus === "queued") return 10;
  return status === "uploading" ? 20 : 0;
}

function isScope(value: unknown): value is TakeoffScope {
  return Boolean(value && typeof value === "object" && Array.isArray((value as TakeoffScope).requests));
}

function serializeTakeoff(takeoff: TakeoffListItem, patch: Partial<TakeoffListItem>): TakeoffListItem {
  return { ...takeoff, ...patch, updatedAt: new Date().toISOString() };
}

export function MaterialTakeoffClient({
  initialTakeoffs,
  selectedTakeoffId,
  googleConnected,
}: {
  initialTakeoffs: TakeoffListItem[];
  selectedTakeoffId?: string;
  googleConnected: boolean;
}) {
  const [takeoffs, setTakeoffs] = useState(initialTakeoffs);
  const [activeId, setActiveId] = useState(selectedTakeoffId ?? initialTakeoffs[0]?.id ?? null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [newName, setNewName] = useState("");
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<EngineSheet[]>([]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<EngineOverlay | null>(null);
  const [quantities, setQuantities] = useState<EngineQuantity[]>([]);
  const [activeQuantityId, setActiveQuantityId] = useState<string | null>(null);
  const [report, setReport] = useState<TakeoffReport | null>(null);
  const [sheetLink, setSheetLink] = useState<string | undefined>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [scopeInstructions, setScopeInstructions] = useState("");
  const [scope, setScope] = useState<TakeoffScope | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const sheetIdRef = useRef<string | null>(null);
  const reviewLoadingRef = useRef(false);
  const reviewLoadedForRef = useRef<string | null>(null);
  const autoDispatchedRef = useRef<Set<string>>(new Set());

  const activeTakeoff = useMemo(
    () => takeoffs.find((takeoff) => takeoff.id === activeId) ?? null,
    [activeId, takeoffs],
  );
  const pollingEnabled = activeTakeoff?.status === "processing" || activeTakeoff?.status === "indexing";

  useEffect(() => {
    sheetIdRef.current = sheetId;
  }, [sheetId]);

  useEffect(() => {
    setAutoAccept(readAutoAcceptSetting(window.localStorage));
  }, []);

  useEffect(() => {
    setScopeInstructions(activeTakeoff?.takeoffInstructions ?? "");
    setScope(isScope(activeTakeoff?.takeoffScope) ? activeTakeoff.takeoffScope : null);
  }, [activeTakeoff?.id, activeTakeoff?.takeoffInstructions, activeTakeoff?.takeoffScope]);

  const loadBridge = useCallback(
    async (exportSheet = false) => {
      if (!activeId) return;
      setBridgeBusy(true);
      try {
        const data = await fetchJson<{ report: TakeoffReport; sheetLink?: string }>(
          `/api/takeoff/${activeId}/bridge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ includeHighConfidence: true, exportSheet }),
          },
        );
        setReport(data.report);
        if (data.sheetLink) setSheetLink(data.sheetLink);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not bridge materials.");
      } finally {
        setBridgeBusy(false);
      }
    },
    [activeId],
  );

  const loadOverlay = useCallback(
    async (nextSheetId: string | null) => {
      if (!activeId || !nextSheetId) {
        setOverlay(null);
        return;
      }
      try {
        const data = await fetchJson<{ overlay: EngineOverlay }>(
          `/api/takeoff/${activeId}/sheets/${nextSheetId}/overlay`,
        );
        setOverlay(data.overlay);
      } catch {
        setOverlay(null);
      }
    },
    [activeId],
  );

  const loadReview = useCallback(async () => {
    if (!activeId || reviewLoadingRef.current) return;
    reviewLoadingRef.current = true;
    try {
      const [sheetData, quantityData] = await Promise.all([
        fetchJson<{ sheets: EngineSheet[] }>(`/api/takeoff/${activeId}/sheets`),
        fetchJson<{ quantities: EngineQuantity[] }>(`/api/takeoff/${activeId}/quantities?needs_review=true`),
      ]);
      setSheets(sheetData.sheets);
      setQuantities(quantityData.quantities);
      const currentSheetId = sheetIdRef.current;
      const nextSheetId = currentSheetId && sheetData.sheets.some((s) => s.id === currentSheetId)
        ? currentSheetId
        : sheetData.sheets[0]?.id ?? null;
      setSheetId(nextSheetId);
      setActiveQuantityId((current) =>
        current && quantityData.quantities.some((q) => q.id === current)
          ? current
          : quantityData.quantities[0]?.id ?? null,
      );
      await loadOverlay(nextSheetId);
      await loadBridge(false);
    } catch (err) {
      reviewLoadedForRef.current = null;
      setError(err instanceof Error ? err.message : "Could not load review workspace.");
    } finally {
      reviewLoadingRef.current = false;
    }
  }, [activeId, loadBridge, loadOverlay]);

  const loadSheets = useCallback(async () => {
    if (!activeId) return;
    try {
      const sheetData = await fetchJson<{ sheets: EngineSheet[] }>(`/api/takeoff/${activeId}/sheets`);
      setSheets(sheetData.sheets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load indexed sheets.");
    }
  }, [activeId]);

  const loadReviewOnce = useCallback(() => {
    if (!activeId || reviewLoadedForRef.current === activeId) return;
    reviewLoadedForRef.current = activeId;
    void loadReview();
  }, [activeId, loadReview]);

  const { snapshot, refresh } = useTakeoffJob(activeId, {
    enabled: pollingEnabled,
    initialStatus: activeTakeoff?.status ?? "created",
    onReview: loadReviewOnce,
  });

  useEffect(() => {
    if (!activeId) return;
    setTakeoffs((current) =>
      current.map((takeoff) =>
        takeoff.id === activeId
          ? serializeTakeoff(takeoff, {
              status: snapshot.status,
              jobStatus: snapshot.jobStatus ?? takeoff.jobStatus,
              jobProgress: snapshot.progress ?? takeoff.jobProgress,
              jobError: snapshot.error ?? takeoff.jobError,
            })
          : takeoff,
      ),
    );
  }, [activeId, snapshot.error, snapshot.jobStatus, snapshot.progress, snapshot.status]);

  useEffect(() => {
    if (activeTakeoff?.status === "review") loadReviewOnce();
  }, [activeTakeoff?.id, activeTakeoff?.status, loadReviewOnce]);

  useEffect(() => {
    if (activeTakeoff?.status === "indexed") void loadSheets();
  }, [activeTakeoff?.id, activeTakeoff?.status, loadSheets]);

  useEffect(() => {
    void loadOverlay(sheetId);
  }, [loadOverlay, sheetId]);

  function updateActive(patch: Partial<TakeoffListItem>) {
    if (!activeId) return;
    setTakeoffs((current) =>
      current.map((takeoff) => (takeoff.id === activeId ? serializeTakeoff(takeoff, patch) : takeoff)),
    );
  }

  async function createAndProcess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!files || files.length === 0) {
      setError("Choose a PDF or TIFF file.");
      return;
    }
    const name = newName.trim() || files[0]?.name.replace(/\.[^.]+$/, "") || "Material takeoff";
    setBusyLabel("Creating");
    try {
      const created = await fetchJson<{ takeoff: TakeoffListItem }>("/api/takeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setTakeoffs((current) => [created.takeoff, ...current]);
      setActiveId(created.takeoff.id);
      window.history.replaceState(null, "", `/material-takeoff?t=${created.takeoff.id}`);

      for (const file of Array.from(files)) {
        setBusyLabel(`Uploading ${file.name}`);
        const form = new FormData();
        form.append("file", file, file.name);
        await fetchJson(`/api/takeoff/${created.takeoff.id}/files`, { method: "POST", body: form });
      }

      setBusyLabel("Indexing");
      const indexed = await fetchJson<{ takeoff: TakeoffListItem }>(
        `/api/takeoff/${created.takeoff.id}/index`,
        { method: "POST" },
      );
      setTakeoffs((current) =>
        current.map((takeoff) => (takeoff.id === created.takeoff.id ? indexed.takeoff : takeoff)),
      );
      setFiles(null);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start indexing.");
    } finally {
      setBusyLabel("");
    }
  }

  async function reprocess() {
    if (!activeId) return;
    setError(null);
    setBusyLabel("Processing");
    try {
      const processScope = scope ?? (isScope(activeTakeoff?.takeoffScope) ? activeTakeoff.takeoffScope : null);
      const data = await fetchJson<{ takeoff: TakeoffListItem }>(`/api/takeoff/${activeId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: processScope ? JSON.stringify({ scope: processScope }) : undefined,
      });
      reviewLoadedForRef.current = null;
      setTakeoffs((current) => current.map((takeoff) => (takeoff.id === activeId ? data.takeoff : takeoff)));
      setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-process.");
    } finally {
      setBusyLabel("");
    }
  }

  async function parseScope() {
    if (!activeId) return;
    setError(null);
    setScopeBusy(true);
    try {
      const data = await fetchJson<{ scope: TakeoffScope }>(`/api/takeoff/${activeId}/scope/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: scopeInstructions }),
      });
      setScope(data.scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse takeoff scope.");
    } finally {
      setScopeBusy(false);
    }
  }

  async function runScopedTakeoff() {
    if (!activeId) return;
    const processScope = scope ?? {
      instructions: scopeInstructions,
      requests: [],
    };
    setError(null);
    setBusyLabel("Processing");
    try {
      const data = await fetchJson<{ takeoff: TakeoffListItem }>(`/api/takeoff/${activeId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: processScope }),
      });
      reviewLoadedForRef.current = null;
      setTakeoffs((current) => current.map((takeoff) => (takeoff.id === activeId ? data.takeoff : takeoff)));
      setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run scoped takeoff.");
    } finally {
      setBusyLabel("");
    }
  }

  async function reviewQuantity(
    qid: string,
    payload: {
      action: ReviewAction;
      corrected_quantity?: number;
      corrected_unit?: string;
      corrected_description?: string;
      comment?: string;
    },
  ) {
    if (!activeId) return;
    setReviewBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/takeoff/${activeId}/quantities/${qid}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const remaining = quantities.filter((q) => q.id !== qid);
      setQuantities(remaining);
      setActiveQuantityId(remaining[0]?.id ?? null);
      await loadBridge(false);
      await loadOverlay(sheetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setReviewBusy(false);
    }
  }

  function toggleAutoAccept() {
    setAutoAccept((current) => {
      const next = !current;
      writeAutoAcceptSetting(window.localStorage, next);
      return next;
    });
  }

  // Accept one high-confidence item at a time while the toggle is on; each
  // accept updates `quantities`, which re-runs the effect for the next item.
  // This also catches items that arrive later (re-process, sheet reloads).
  useEffect(() => {
    if (reviewBusy) return;
    const target = nextAutoAcceptTarget(autoAccept, quantities, autoDispatchedRef.current);
    if (!target) return;
    autoDispatchedRef.current.add(target.id);
    void reviewQuantity(target.id, { action: "accept" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept, quantities, reviewBusy]);

  function selectTakeoff(id: string) {
    setActiveId(id);
    window.history.replaceState(null, "", `/material-takeoff?t=${id}`);
    setSheets([]);
    setSheetId(null);
    setOverlay(null);
    setQuantities([]);
    setReport(null);
    setSheetLink(undefined);
    setError(null);
    reviewLoadedForRef.current = null;
    autoDispatchedRef.current = new Set();
  }

  const progress = coarseProgress(snapshot.status, snapshot.jobStatus);

  return (
    <PageShell title="Material Takeoff" description="Engine-backed review and CSI material rollup.">
      <div className="space-y-5">
        <form
          onSubmit={createAndProcess}
          className="grid gap-3 rounded-[18px] border border-ember-border bg-ember-surface p-5 shadow-ember-card md:grid-cols-[1fr_1.2fr_auto]"
        >
          <div>
            <Label htmlFor="takeoff-name">Name</Label>
            <Input
              id="takeoff-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Project or bid package"
            />
          </div>
          <div>
            <Label htmlFor="takeoff-files">PDF/TIFF</Label>
            <input
              id="takeoff-files"
              type="file"
              multiple
              accept="application/pdf,image/tiff,.pdf,.tif,.tiff"
              onChange={(event) => setFiles(event.target.files)}
              className="block h-10 w-full text-sm text-ember-muted file:mr-3 file:h-10 file:rounded-full file:border-0 file:bg-ember-subtle file:px-4 file:text-sm file:font-semibold file:text-ember-text"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={Boolean(busyLabel)} className="w-full md:w-auto">
              {busyLabel ? <Spinner /> : <Upload size={16} />}
              {busyLabel || "Start"}
            </Button>
          </div>
        </form>

        {error && (
          <div className="rounded-xl border border-ember-danger/30 bg-ember-danger-bg px-3.5 py-2.5 text-sm text-ember-danger">
            {error}
          </div>
        )}

        {activeTakeoff && (
          <div className="rounded-[18px] border border-ember-border bg-ember-surface p-5 shadow-ember-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-ember-text">{activeTakeoff.name}</h2>
                  <Badge className={statusTone(snapshot.status)}>{snapshot.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-ember-muted">
                  {snapshot.progress || snapshot.jobStatus || activeTakeoff.jobProgress || "Ready"}
                  {snapshot.engineDown ? " - engine paused" : ""}
                  {snapshot.stalled ? " - stalled" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={refresh}>
                  <RefreshCw size={16} />
                  Check
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={reprocess} disabled={Boolean(busyLabel)}>
                  <Play size={16} />
                  Run
                </Button>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ember-border">
              <div className="h-full bg-ember-accent-solid transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {activeTakeoff && activeTakeoff.status !== "processing" && activeTakeoff.status !== "indexing" && (
          <div className="rounded-[18px] border border-ember-border bg-ember-surface p-5 shadow-ember-card">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <Label htmlFor="scope-instructions">Takeoff instructions</Label>
                <Textarea
                  id="scope-instructions"
                  rows={3}
                  value={scopeInstructions}
                  onChange={(event) => setScopeInstructions(event.target.value)}
                  placeholder="Do door takeoffs on A1.00 and floor takeoffs on A8.00"
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!activeId || scopeBusy || !scopeInstructions.trim()}
                  onClick={parseScope}
                >
                  {scopeBusy ? <Spinner /> : <RefreshCw size={16} />}
                  Parse
                </Button>
                <Button
                  type="button"
                  disabled={!activeId || Boolean(busyLabel) || !scope}
                  onClick={runScopedTakeoff}
                >
                  {busyLabel === "Processing" ? <Spinner /> : <Play size={16} />}
                  Run scoped takeoff
                </Button>
              </div>
            </div>
            {scope && (
              <div className="mt-3 flex flex-wrap gap-2">
                {scope.requests.length === 0 ? (
                  <Badge className="bg-ember-tint text-ember-tint-text">
                    All indexed sheets
                  </Badge>
                ) : (
                  scope.requests.map((request, index) => (
                    <Badge key={index} className="bg-ember-tint text-ember-tint-text">
                      {request.trade} · {(request.sheet_refs.length ? request.sheet_refs : request.sheet_ids).join(", ") || "all sheets"}
                    </Badge>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)_340px]">
          <aside className="space-y-5">
            <div className="overflow-hidden rounded-[18px] border border-ember-border bg-ember-surface shadow-ember-card">
              <div className="border-b border-ember-border px-4 py-2.5 text-sm font-semibold text-ember-text">
                Takeoffs
              </div>
              <div className="max-h-72 overflow-y-auto">
                {takeoffs.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-ember-muted">
                    <FileUp className="mb-2" size={18} />
                    No takeoffs yet.
                  </div>
                ) : (
                  takeoffs.map((takeoff) => (
                    <button
                      key={takeoff.id}
                      type="button"
                      onClick={() => selectTakeoff(takeoff.id)}
                      className={`block w-full border-b border-ember-border px-4 py-2.5 text-left transition-colors hover:bg-ember-subtle ${
                        takeoff.id === activeId ? "bg-ember-subtle" : ""
                      }`}
                    >
                      <div className="truncate text-sm font-medium text-ember-text">{takeoff.name}</div>
                      <div className="mt-1 text-xs text-ember-muted">{takeoff.status}</div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-[18px] border border-ember-border bg-ember-surface shadow-ember-card">
              <div className="flex items-center justify-between border-b border-ember-border px-4 py-2.5">
                <span className="text-sm font-semibold text-ember-text">Sheets</span>
                <Button type="button" variant="ghost" size="sm" onClick={loadReview} disabled={!activeId}>
                  <RotateCcw size={15} />
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {sheets.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-ember-muted">No sheets loaded.</div>
                ) : (
                  sheets.map((sheet) => {
                    const count = quantities.filter((q) => q.sheet_id === sheet.id).length;
                    return (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => setSheetId(sheet.id)}
                        className={`block w-full border-b border-ember-border px-4 py-2.5 text-left transition-colors hover:bg-ember-subtle ${
                          sheet.id === sheetId ? "bg-ember-subtle" : ""
                        }`}
                      >
                        <div className="truncate text-sm font-medium text-ember-text">
                          {sheet.sheet_number || `Page ${sheet.page_number}`}
                        </div>
                        <div className="mt-1 text-xs text-ember-muted">
                          {count} review item{count === 1 ? "" : "s"}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <div className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <span id="auto-accept-label" className="text-xs font-medium text-ember-muted">
                Auto-accept high confidence
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoAccept}
                aria-labelledby="auto-accept-label"
                onClick={toggleAutoAccept}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
                  autoAccept ? "bg-ember-accent-solid" : "bg-ember-border"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                    autoAccept ? "translate-x-[18px]" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <ReviewQueue
              quantities={quantities}
              activeId={activeQuantityId}
              busy={reviewBusy}
              onSelect={setActiveQuantityId}
              onReview={reviewQuantity}
              onReload={loadReview}
              onCalibrate={() => undefined}
            />
          </div>

          <MaterialsPreview
            report={report}
            sheetLink={sheetLink}
            googleConnected={googleConnected}
            busy={bridgeBusy}
            onExportSheet={() => loadBridge(true)}
          />
        </div>

        <OverlayViewer
          takeoffId={activeId}
          sheetId={sheetId}
          overlay={overlay}
          activeQuantityId={activeQuantityId}
          onSelectQuantity={setActiveQuantityId}
          onCalibrated={() => {
            reviewLoadedForRef.current = null;
            updateActive({ status: "processing", jobStatus: "queued", jobProgress: "" });
            setReport(null);
          }}
          disabled={!activeId}
        />
      </div>
    </PageShell>
  );
}
