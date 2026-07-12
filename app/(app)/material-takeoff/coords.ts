import type { PagePoint } from "@/lib/takeoff-engine/types";

export type DisplayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function pageToScreen(
  point: PagePoint,
  rect: DisplayRect,
  page: { widthPt: number; heightPt: number },
): PagePoint {
  return [
    rect.left + point[0] * (rect.width / page.widthPt),
    rect.top + point[1] * (rect.height / page.heightPt),
  ];
}

export function screenToPage(
  point: PagePoint,
  rect: DisplayRect,
  page: { widthPt: number; heightPt: number },
): PagePoint {
  return [
    (point[0] - rect.left) * (page.widthPt / rect.width),
    (point[1] - rect.top) * (page.heightPt / rect.height),
  ];
}

export function manualFtPerPoint(p1: PagePoint, p2: PagePoint, realDistanceFt: number): number {
  const pointDistance = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  return realDistanceFt / pointDistance;
}

export function polygonPoints(points: PagePoint[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}
