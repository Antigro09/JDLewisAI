import { describe, expect, it } from "vitest";
import { manualFtPerPoint, pageToScreen, screenToPage } from "./coords";

describe("material takeoff coordinate transforms", () => {
  it("round-trips page points through displayed CSS pixels", () => {
    const page = { widthPt: 792, heightPt: 612 };
    const rects = [
      { left: 0, top: 0, width: 792, height: 612 },
      { left: 20, top: 40, width: 396, height: 306 },
      { left: 100, top: 12, width: 1188, height: 918 },
    ];
    const points: [number, number][] = [
      [0, 0],
      [250.25, 100.5],
      [791.5, 611.25],
    ];

    for (const rect of rects) {
      for (const point of points) {
        const screen = pageToScreen(point, rect, page);
        const roundTrip = screenToPage(screen, rect, page);
        expect(roundTrip[0]).toBeCloseTo(point[0], 6);
        expect(roundTrip[1]).toBeCloseTo(point[1], 6);
      }
    }
  });

  it("matches engine manual calibration math", () => {
    expect(manualFtPerPoint([10, 10], [110, 10], 24)).toBeCloseTo(0.24, 6);
  });
});
