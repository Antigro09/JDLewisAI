"use client";

import { Check, Edit3, Filter, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import type { EngineQuantity, ReviewAction } from "@/lib/takeoff-engine/types";
import { quantityAuditNote } from "./review-audit-note";

function confidence(q: EngineQuantity): number {
  return Math.max(0, Math.min(1, q.final_confidence ?? 0));
}

function reasonLabel(reason: string): string {
  return reason.replace(/_/g, " ");
}

export function ReviewQueue({
  quantities,
  activeId,
  busy,
  onSelect,
  onReview,
  onReload,
  onCalibrate,
}: {
  quantities: EngineQuantity[];
  activeId: string | null;
  busy?: boolean;
  onSelect: (id: string) => void;
  onReview: (
    qid: string,
    payload: {
      action: ReviewAction;
      corrected_quantity?: number;
      corrected_unit?: string;
      corrected_description?: string;
      comment?: string;
    },
  ) => void;
  onReload: () => void;
  onCalibrate: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [comment, setComment] = useState("");

  const sorted = useMemo(() => {
    return [...quantities]
      .filter((q) => !filter || q.item_type === filter)
      .sort((a, b) => {
        if (a.needs_review !== b.needs_review) return a.needs_review ? -1 : 1;
        return confidence(a) - confidence(b);
      });
  }, [filter, quantities]);
  const active = sorted.find((q) => q.id === activeId) ?? sorted[0] ?? null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!active || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key.toLowerCase() === "a") onReview(active.id, { action: "accept" });
      if (event.key.toLowerCase() === "r") onReview(active.id, { action: "reject" });
      if (event.key.toLowerCase() === "e") {
        setEditingId(active.id);
        setEditQuantity(String(active.quantity));
        setEditUnit(active.unit);
        setEditDescription(active.description);
      }
      if (event.key === "]") {
        const index = sorted.findIndex((q) => q.id === active.id);
        const next = sorted[index + 1] ?? sorted[0];
        if (next) onSelect(next.id);
      }
      if (event.key === "[") {
        const index = sorted.findIndex((q) => q.id === active.id);
        const prev = sorted[index - 1] ?? sorted[sorted.length - 1];
        if (prev) onSelect(prev.id);
      }
      if (event.key.toLowerCase() === "c") onCalibrate();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onCalibrate, onReview, onSelect, sorted]);

  const itemTypes = Array.from(new Set(quantities.map((q) => q.item_type))).sort();

  function startEdit(q: EngineQuantity) {
    setEditingId(q.id);
    setEditQuantity(String(q.quantity));
    setEditUnit(q.unit);
    setEditDescription(q.description);
    setComment("");
  }

  function saveEdit(qid: string) {
    const corrected = Number(editQuantity);
    if (!Number.isFinite(corrected)) return;
    onReview(qid, {
      action: "edit",
      corrected_quantity: corrected,
      corrected_unit: editUnit || undefined,
      corrected_description: editDescription || undefined,
      comment,
    });
    setEditingId(null);
  }

  return (
    <div className="flex min-h-[300px] flex-col overflow-hidden rounded-[18px] border border-ember-border bg-ember-surface shadow-ember-card">
      <div className="flex items-center justify-between gap-2 border-b border-ember-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-ember-text">Review Queue</h2>
          <p className="text-xs text-ember-muted">{sorted.length} item{sorted.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-ember-muted" />
          <Select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-8 max-w-36">
            <option value="">All</option>
            {itemTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
          <Button type="button" variant="ghost" size="sm" title="Reload" onClick={onReload}>
            <RotateCcw size={15} />
          </Button>
        </div>
      </div>

      <div className="max-h-[520px] flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-3 py-8 text-sm text-ember-muted">No review items are waiting.</div>
        ) : (
          sorted.map((q) => {
            const isActive = q.id === active?.id;
            const isEditing = editingId === q.id;
            const auditNote = quantityAuditNote(q);
            return (
              <div
                key={q.id}
                className={`border-b border-ember-border px-3 py-3 transition-colors ${
                  isActive ? "bg-ember-subtle" : "bg-transparent hover:bg-ember-subtle/60"
                }`}
              >
                <button type="button" className="block w-full text-left" onClick={() => onSelect(q.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ember-text">{q.description}</div>
                      <div className="mt-0.5 text-xs text-ember-muted">
                        {q.quantity.toLocaleString()} {q.unit} - {q.item_type}
                      </div>
                      {auditNote && <div className="mt-0.5 text-xs text-ember-muted">{auditNote}</div>}
                    </div>
                    <div className="w-16 shrink-0 pt-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-ember-border">
                        <div
                          className="h-full bg-ember-success"
                          style={{ width: `${confidence(q) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  {q.review_reason && q.review_reason.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {q.review_reason.map((reason) => (
                        <Badge key={reason} className="bg-ember-warning-bg text-ember-warning">
                          {reasonLabel(reason)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>

                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-[1fr_88px] gap-2">
                      <Input
                        type="number"
                        value={editQuantity}
                        onChange={(event) => setEditQuantity(event.target.value)}
                        placeholder="Quantity"
                      />
                      <Input value={editUnit} onChange={(event) => setEditUnit(event.target.value)} />
                    </div>
                    <Input
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      placeholder="Description"
                    />
                    <Textarea
                      rows={2}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Comment"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !(Number(editQuantity) >= 0)}
                        onClick={() => saveEdit(q.id)}
                      >
                        <Check size={15} />
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X size={15} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => onReview(q.id, { action: "accept" })}>
                      <Check size={15} />
                      Accept
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => startEdit(q)}>
                      <Edit3 size={15} />
                      Edit
                    </Button>
                    <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => onReview(q.id, { action: "reject" })}>
                      <X size={15} />
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
