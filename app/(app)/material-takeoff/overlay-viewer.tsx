"use client";

import { Crosshair, LocateFixed, Minus, MoveHorizontal, Plus, Ruler, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import type { EngineOverlay, OverlaySegment, PagePoint } from "@/lib/takeoff-engine/types";
import { manualFtPerPoint, screenToPage } from "./coords";

type CalibrationState = {
  distanceFt: string;
  points: PagePoint[];
};

function ringPath(points: PagePoint[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first[0]} ${first[1]} ${rest.map(([x, y]) => `L ${x} ${y}`).join(" ")} Z`;
}

function polygonPath(exterior: PagePoint[], holes: PagePoint[][] = []): string {
  return [exterior, ...holes].map(ringPath).filter(Boolean).join(" ");
}

function SegmentGuides({
  segments,
  stroke,
  fontSize,
}: {
  segments: OverlaySegment[];
  stroke: string;
  fontSize: number;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        const [x1, y1] = segment.p1;
        const [x2, y2] = segment.p2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (length === 0) return null;
        const nx = -dy / length;
        const ny = dx / length;
        const tick = fontSize * 0.5;
        // Offset the label a few points toward the upward side of the line.
        const side = ny > 0 ? -1 : 1;
        const lx = (x1 + x2) / 2 + nx * fontSize * side;
        const ly = (y1 + y2) / 2 + ny * fontSize * side;
        const vertical = Math.abs(dy) > Math.abs(dx);
        return (
          <g key={index}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeOpacity={0.6}
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            {[segment.p1, segment.p2].map(([px, py], end) => (
              <line
                key={end}
                x1={px - nx * tick}
                y1={py - ny * tick}
                x2={px + nx * tick}
                y2={py + ny * tick}
                stroke={stroke}
                strokeOpacity={0.6}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* SVG text ignores non-scaling-stroke, so fontSize is computed in
                viewBox units from the sheet width to stay legible at fit zoom. */}
            <text
              x={lx}
              y={ly}
              fill={stroke}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              stroke="#ffffff"
              strokeWidth={fontSize * 0.2}
              paintOrder="stroke"
              transform={vertical ? `rotate(-90 ${lx} ${ly})` : undefined}
            >
              {segment.label}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function OverlayViewer({
  takeoffId,
  sheetId,
  overlay,
  activeQuantityId,
  onSelectQuantity,
  onCalibrated,
  disabled,
}: {
  takeoffId: string | null;
  sheetId: string | null;
  overlay: EngineOverlay | null;
  activeQuantityId: string | null;
  onSelectQuantity: (id: string) => void;
  onCalibrated: () => void;
  disabled?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showLengths, setShowLengths] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [busy, setBusy] = useState(false);
  const widthPt = overlay?.width_pt ?? 1;
  const heightPt = overlay?.height_pt ?? 1;
  const labelFontSize = Math.max(6, widthPt / 220);
  const imageUrl = takeoffId && sheetId
    ? `/api/takeoff/${takeoffId}/sheets/${sheetId}/image`
    : "";
  const canCalibrate = Boolean(takeoffId && sheetId && overlay && !disabled);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Contain-fit the sheet to the viewer: the largest size that fits both axes
  // (letterbox), scaled by zoom. Falls back to width-based sizing until the
  // container has been measured.
  const fit = useMemo(() => {
    const availW = containerSize.w - 24; // p-3 (12px) each side
    const availH = containerSize.h - 24;
    if (availW <= 0 || availH <= 0) return null;
    const aspect = widthPt / heightPt;
    if (availW / availH > aspect) return { w: availH * aspect, h: availH };
    return { w: availW, h: availW / aspect };
  }, [containerSize.w, containerSize.h, widthPt, heightPt]);

  const previewFtPerPoint = useMemo(() => {
    if (!calibration || calibration.points.length !== 2) return null;
    const distance = Number(calibration.distanceFt);
    if (!(distance > 0)) return null;
    return manualFtPerPoint(calibration.points[0], calibration.points[1], distance);
  }, [calibration]);

  async function submitCalibration() {
    if (!takeoffId || !sheetId || !calibration || calibration.points.length !== 2) return;
    const distance = Number(calibration.distanceFt);
    if (!(distance > 0)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/takeoff/${takeoffId}/sheets/${sheetId}/calibrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p1: calibration.points[0],
          p2: calibration.points[1],
          real_distance_ft: distance,
        }),
      });
      if (!response.ok) throw new Error("Calibration failed.");
      await fetch(`/api/takeoff/${takeoffId}/process`, { method: "POST" });
      setCalibration(null);
      onCalibrated();
    } finally {
      setBusy(false);
    }
  }

  function handlePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!calibration || !overlay || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const point = screenToPage([event.clientX, event.clientY], rect, {
      widthPt: overlay.width_pt,
      heightPt: overlay.height_pt,
    });
    setCalibration((current) => {
      if (!current) return current;
      if (current.points.length >= 2) return { ...current, points: [point] };
      return { ...current, points: [...current.points, point] };
    });
  }

  return (
    <div className="flex h-[72vh] min-h-[560px] flex-col overflow-hidden rounded-[18px] border border-ember-border bg-ember-surface shadow-ember-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ember-border px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          >
            <Minus size={16} />
          </Button>
          <Button type="button" variant="ghost" size="sm" title="Fit" onClick={() => setZoom(1)}>
            <LocateFixed size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(8, z + (z >= 2.5 ? 0.5 : 0.1)))}
          >
            <Plus size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Show lengths"
            aria-pressed={showLengths}
            onClick={() => setShowLengths((v) => !v)}
            className={showLengths ? "bg-ember-subtle text-ember-text" : ""}
          >
            <MoveHorizontal size={16} />
            Lengths
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {calibration && (
            <>
              <Input
                aria-label="Known distance in feet"
                type="number"
                min="0"
                step="0.01"
                value={calibration.distanceFt}
                onChange={(event) =>
                  setCalibration((current) =>
                    current ? { ...current, distanceFt: event.target.value } : current,
                  )
                }
                className="h-8 w-28 rounded-lg"
                placeholder="ft"
              />
              <span className="text-xs text-ember-muted">
                {calibration.points.length}/2
                {previewFtPerPoint
                  ? ` - ${previewFtPerPoint.toFixed(5)} ft/pt`
                  : " - no current scale"}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={busy || calibration.points.length !== 2 || !(Number(calibration.distanceFt) > 0)}
                onClick={submitCalibration}
              >
                <Ruler size={16} />
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCalibration(null)}>
                <X size={16} />
              </Button>
            </>
          )}
          {!calibration && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canCalibrate}
              onClick={() => setCalibration({ distanceFt: "", points: [] })}
            >
              <Crosshair size={16} />
              Calibrate
            </Button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-neutral-950/5 p-3 dark:bg-black/20"
      >
        {!overlay || !sheetId ? (
          <div className="flex h-full min-h-[440px] items-center justify-center text-sm text-ember-muted">
            Select a processed sheet to review overlays.
          </div>
        ) : (
          <div className="flex min-h-full min-w-full">
          <div
            ref={wrapperRef}
            onPointerDown={handlePointer}
            className={`relative m-auto overflow-hidden bg-white shadow-sm ${
              calibration ? "cursor-crosshair" : ""
            }`}
            style={
              fit
                ? { width: fit.w * zoom, height: fit.h * zoom }
                : {
                    aspectRatio: `${widthPt} / ${heightPt}`,
                    width: `${Math.min(100 * zoom, 800)}%`,
                    maxWidth: zoom === 1 ? "100%" : "none",
                  }
            }
          >
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full select-none object-fill"
              draggable={false}
            />
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${widthPt} ${heightPt}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {overlay.features.map((feature) => {
                const active = feature.quantity_id === activeQuantityId;
                const hidden = feature.review_status === "rejected";
                if (hidden) return null;
                const stroke = active ? "#0f766e" : feature.style?.stroke ?? "#2563eb";
                const fill = active ? "#14b8a633" : feature.style?.fill ?? "#2563eb22";
                const dash = feature.needs_review ? "6 4" : feature.style?.dash;
                return (
                  <g
                    key={feature.quantity_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectQuantity(feature.quantity_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onSelectQuantity(feature.quantity_id);
                    }}
                    className="cursor-pointer outline-none"
                  >
                    {/* Stroke width is in SCREEN pixels (non-scaling): an Arch E
                        sheet fit into a ~800px column draws page-point strokes
                        at half a pixel, making thin wall rectangles invisible. */}
                    {feature.polygons?.map((ring, index) => (
                      <path
                        key={`${feature.quantity_id}-poly-${index}`}
                        d={polygonPath(ring, feature.holes?.[index])}
                        fill={fill}
                        fillRule="evenodd"
                        clipRule="evenodd"
                        stroke={stroke}
                        strokeWidth={active ? 3 : feature.style?.stroke_width ?? 1.5}
                        strokeDasharray={dash}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {feature.boxes?.map(([x0, y0, x1, y1], index) => (
                      <rect
                        key={`${feature.quantity_id}-box-${index}`}
                        x={x0}
                        y={y0}
                        width={x1 - x0}
                        height={y1 - y0}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={active ? 3 : feature.style?.stroke_width ?? 1.5}
                        strokeDasharray={dash}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </g>
                );
              })}
              <g pointerEvents="none">
                {overlay.features.map((feature) => {
                  if (feature.review_status === "rejected" || !feature.segments?.length) return null;
                  const active = feature.quantity_id === activeQuantityId;
                  if (!active && !(showLengths && feature.item_type === "wall")) return null;
                  const stroke = active ? "#0f766e" : feature.style?.stroke ?? "#2563eb";
                  return (
                    <SegmentGuides
                      key={`${feature.quantity_id}-guides`}
                      segments={feature.segments}
                      stroke={stroke}
                      fontSize={labelFontSize}
                    />
                  );
                })}
              </g>
              {calibration?.points.map(([x, y], index) => (
                <g key={index}>
                  <line x1={x - 8} y1={y} x2={x + 8} y2={y} stroke="#dc2626" strokeWidth={2} />
                  <line x1={x} y1={y - 8} x2={x} y2={y + 8} stroke="#dc2626" strokeWidth={2} />
                </g>
              ))}
              {calibration?.points.length === 2 && (
                <line
                  x1={calibration.points[0][0]}
                  y1={calibration.points[0][1]}
                  x2={calibration.points[1][0]}
                  y2={calibration.points[1][1]}
                  stroke="#dc2626"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )}
            </svg>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
