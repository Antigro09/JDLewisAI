/**
 * Material takeoff engine — drawings in, CSI-organized material quantities out.
 *
 * Implements the professional 7-step estimating sequence:
 *   1. Gather documents      → `ingestFiles` (multi-page PDF/image validation)
 *   2. Review scope          → `TradeScope` filter (prompt-level + hard filter)
 *   3. Set up measurement    → `ScaleCalibration` (parsed scale strings or
 *                              known-dimension calibration; never LLM-guessed)
 *   4. Measure components    → `normalizeMeasurement` (count/length/area/volume)
 *   5. Convert to materials  → `ASSEMBLIES` (deterministic formula registry)
 *   6. Organize the list     → `organizeReport` (Trade × CSI MasterFormat)
 *   7. Hand off to pricing   → `applyPricing` (quantities separate from rates)
 *
 * Division of labor (non-negotiable design rule):
 *   - The LLM ONLY classifies and transcribes: what an item is, which trade it
 *     belongs to, and the dimension strings printed on the drawing — verbatim.
 *     It never multiplies, never converts units, never guesses a scale.
 *   - All arithmetic (feet-inch parsing, scale mapping, geometry, waste,
 *     packaging, pricing extensions) is local TypeScript in this file.
 */

/* ------------------------------------------------------------------ */
/* Units & dimension-string parsing                                    */
/* ------------------------------------------------------------------ */

export type QuantityUnit = "EA" | "LF" | "SF" | "CY";

export type PurchaseUnit =
  | "EA"
  | "LF"
  | "SF"
  | "CY"
  | "SHEET"
  | "STICK"
  | "BOX"
  | "ROLL"
  | "PAIL"
  | "GAL"
  | "BAG"
  | "KIT";

const FRACTION = /(\d+)\s*\/\s*(\d+)/;

function parseNumberWithFraction(raw: string): number | null {
  const s = raw.trim();
  // "6 1/2" or "1/2"
  const m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*(?:${FRACTION.source})?$`));
  if (!m || (!m[1] && !m[2])) return null;
  let value = m[1] ? Number(m[1]) : 0;
  if (m[2] && m[3]) {
    const den = Number(m[3]);
    if (den === 0) return null;
    value += Number(m[2]) / den;
  }
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse an architectural dimension string to DECIMAL FEET. Handles:
 *   24'-6"  ·  24' 6 1/2"  ·  24'  ·  8"  ·  12.5'  ·  3/4"  ·  10 ft  ·  3.5 m
 * Bare numbers use `defaultUnit`. Returns null (never NaN) on garbage.
 */
export function parseFeetInches(
  raw: string | number | null | undefined,
  defaultUnit: "ft" | "in" = "ft",
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? (defaultUnit === "in" ? raw / 12 : raw) : null;
  }
  // Normalize curly quotes and unicode fraction slash, collapse whitespace.
  const s = raw
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/⁄/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  // Metric: "3.5 m" / "3500 mm" / "3.5m"
  const metric = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/i);
  if (metric) {
    const v = Number(metric[1]);
    const unit = metric[2].toLowerCase();
    const meters = unit === "mm" ? v / 1000 : unit === "cm" ? v / 100 : v;
    return meters * 3.28084;
  }

  // Word units: "24 ft", "24 LF", "6 in"
  const word = s.match(/^([\d\s./]+)\s*(ft|feet|lf|in|inch|inches)\.?$/i);
  if (word) {
    const v = parseNumberWithFraction(word[1]);
    if (v === null) return null;
    return /^(in|inch|inches)$/i.test(word[2]) ? v / 12 : v;
  }

  // Feet-and-inches: 24'-6 1/2"  |  24' 6"  |  24'  |  6 1/2"  |  6"
  const ftIn = s.match(/^(?:([\d\s./]+?)\s*')?\s*[-–]?\s*(?:([\d\s./]+?)\s*")?$/);
  if (ftIn && (ftIn[1] || ftIn[2])) {
    const feet = ftIn[1] ? parseNumberWithFraction(ftIn[1]) : 0;
    const inches = ftIn[2] ? parseNumberWithFraction(ftIn[2]) : 0;
    if (feet === null || inches === null) return null;
    return feet + inches / 12;
  }

  // Bare number → defaultUnit
  const bare = parseNumberWithFraction(s);
  if (bare !== null) return defaultUnit === "in" ? bare / 12 : bare;
  return null;
}

/* ------------------------------------------------------------------ */
/* Step 3 — measurement method: scale calibration                      */
/* ------------------------------------------------------------------ */

export type ScaleParse =
  | { kind: "calibrated"; calibration: ScaleCalibration }
  | { kind: "nts" }
  | { kind: "unparsed"; raw: string };

/**
 * Maps drawing space to real-world decimal feet. Built EITHER from the title
 * block's printed scale string (`1/4" = 1'-0"`) or by calibrating against a
 * printed dimension of known length — never from an LLM eyeballing an image.
 */
export class ScaleCalibration {
  private constructor(
    /** Real-world feet represented by one drawing inch (paper space). */
    readonly feetPerDrawingInch: number,
    /** Raster density used to map pixels → drawing inches. */
    readonly dpi: number,
    /** How this calibration was established (audit trail). */
    readonly method: string,
  ) {}

  /** Real feet per raster pixel. */
  get feetPerPixel(): number {
    return this.feetPerDrawingInch / this.dpi;
  }

  /**
   * Parse an architectural / engineering / ratio scale string.
   *   1/4" = 1'-0"   ·  1-1/2" = 1'   ·  1" = 20'   ·  1:100   ·  NTS
   */
  static fromScaleString(raw: string, opts: { dpi?: number } = {}): ScaleParse {
    const dpi = opts.dpi ?? 150;
    const s = raw
      .replace(/[‘’′]/g, "'")
      .replace(/[“”″]/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    if (/(^|\b)(n\.?\s*t\.?\s*s\.?|not\s+to\s+scale)(\b|$)/i.test(s)) {
      return { kind: "nts" };
    }

    // Ratio scales: "1:100" — one drawing unit = N real units.
    const ratio = s.match(/^1\s*:\s*(\d+(?:\.\d+)?)$/);
    if (ratio) {
      const n = Number(ratio[1]);
      if (n > 0) {
        // 1 drawing inch = n real inches = n/12 real feet.
        return {
          kind: "calibrated",
          calibration: new ScaleCalibration(n / 12, dpi, `ratio 1:${n}`),
        };
      }
    }

    // "X" = Y'-Z"" (architectural) or "X" = Y'" (engineering).
    const eq = s.match(/^(.+?)"\s*=\s*(.+)$/);
    if (eq) {
      const drawingInches = parseNumberWithFraction(eq[1].replace(/-/g, " "));
      const realFeet = parseFeetInches(eq[2]);
      if (drawingInches && drawingInches > 0 && realFeet && realFeet > 0) {
        return {
          kind: "calibrated",
          calibration: new ScaleCalibration(
            realFeet / drawingInches,
            dpi,
            `scale string "${s}" @ ${dpi}dpi`,
          ),
        };
      }
    }

    return { kind: "unparsed", raw: s };
  }

  /**
   * Calibrate from a printed dimension of known length: the distance in pixels
   * between the dimension's extension lines, and the printed text (e.g.
   * `24'-6"`). This beats trusting the title block when a PDF was re-scaled.
   */
  static fromKnownDimension(opts: {
    pixelDistance: number;
    dimensionText: string;
    dpi?: number;
  }): ScaleCalibration | null {
    const feet = parseFeetInches(opts.dimensionText);
    if (!feet || feet <= 0 || !(opts.pixelDistance > 0)) return null;
    const dpi = opts.dpi ?? 150;
    const feetPerPixel = feet / opts.pixelDistance;
    return new ScaleCalibration(
      feetPerPixel * dpi,
      dpi,
      `known dimension "${opts.dimensionText}" over ${opts.pixelDistance}px`,
    );
  }

  lengthFt(pixels: number): number {
    return pixels * this.feetPerPixel;
  }

  areaSf(pixelArea: number): number {
    return pixelArea * this.feetPerPixel * this.feetPerPixel;
  }

  describe(): string {
    return `${this.feetPerDrawingInch.toFixed(4)} ft per drawing inch (${this.method})`;
  }
}

/* ------------------------------------------------------------------ */
/* Geometry (pixel space; calibration converts to feet)                */
/* ------------------------------------------------------------------ */

export type Vertex = { x: number; y: number };

export function polylineLengthPx(vertices: Vertex[]): number {
  let total = 0;
  for (let i = 1; i < vertices.length; i++) {
    total += Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].y - vertices[i - 1].y);
  }
  return total;
}

/** Shoelace formula — vertices in order, polygon closed implicitly. */
export function polygonAreaPx(vertices: Vertex[]): number {
  if (vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/* ------------------------------------------------------------------ */
/* Step 6 — CSI MasterFormat divisions & trades                        */
/* ------------------------------------------------------------------ */

export const CSI_DIVISIONS = {
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics & Composites",
  "07": "Thermal & Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "26": "Electrical",
  "31": "Earthwork",
  "32": "Exterior Improvements",
} as const;

export type CsiDivision = keyof typeof CSI_DIVISIONS;

export const TRADES = [
  "concrete",
  "masonry",
  "framing",
  "drywall",
  "insulation",
  "paint",
  "flooring",
  "doors_windows",
  "plumbing",
  "hvac",
  "electrical",
  "fire_protection",
  "earthwork",
  "general",
] as const;

export type Trade = (typeof TRADES)[number];

const TRADE_DEFAULT_DIVISION: Record<Trade, CsiDivision> = {
  concrete: "03",
  masonry: "04",
  framing: "06",
  drywall: "09",
  insulation: "07",
  paint: "09",
  flooring: "09",
  doors_windows: "08",
  plumbing: "22",
  hvac: "23",
  electrical: "26",
  fire_protection: "21",
  earthwork: "31",
  general: "09",
};

/** Step 2 — scope: restrict the takeoff to specific trades. */
export type TradeScope = {
  trades?: Trade[];
};

function inScope(trade: Trade, scope: TradeScope | undefined): boolean {
  if (!scope?.trades?.length) return true;
  return scope.trades.includes(trade);
}

/* ------------------------------------------------------------------ */
/* Step 4 — measurements                                               */
/* ------------------------------------------------------------------ */

export type MeasurementKind = "count" | "length" | "area" | "volume";

const KIND_UNIT: Record<MeasurementKind, QuantityUnit> = {
  count: "EA",
  length: "LF",
  area: "SF",
  volume: "CY",
};

/** What the LLM is allowed to return per item: classification + verbatim
 *  transcription. NO computed values — dimension strings only. */
export type RawMeasurement = {
  kind: MeasurementKind;
  trade: Trade;
  /** Registry key when the model recognizes the assembly (e.g. "drywall-wall"). */
  assembly?: string;
  label: string;
  /** count: number of identical items seen (schedule rows, fixture symbols). */
  count?: number;
  /** Dimension STRINGS transcribed verbatim from the drawing. */
  dims?: {
    length?: string;
    width?: string;
    height?: string;
    depth?: string;
    /** A printed, pre-computed value (e.g. schedule says "1,240 SF"). */
    value?: string;
    valueUnit?: "LF" | "SF" | "SY" | "CY" | "CF";
  };
  /** Optional traced geometry in pixel space (needs a ScaleCalibration). */
  pixels?: { vertices: Vertex[]; closed?: boolean };
  source: "dimension_string" | "schedule" | "traced" | "estimated";
  confidence?: number;
  notes?: string;
};

export type RawSheet = {
  pageNumber: number;
  sheetId?: string;
  sheetTitle?: string;
  /** Title-block scale string transcribed VERBATIM (or null if absent). */
  scaleText?: string | null;
  measurements: RawMeasurement[];
};

export type Measurement = {
  kind: MeasurementKind;
  /** Normalized quantity in the kind's canonical unit (EA/LF/SF/CY). */
  quantity: number;
  unit: QuantityUnit;
  trade: Trade;
  assemblyId?: string;
  label: string;
  sheetRef: string;
  /** Exactly how the number was produced — the estimator's audit trail. */
  basis: string;
  source: RawMeasurement["source"];
  assumptions: string[];
  assemblyParams?: Record<string, number>;
};

export type TakeoffIssue = {
  severity: "warning" | "error";
  where: string;
  message: string;
};

function toFt(
  raw: string | undefined,
  what: string,
  issues: TakeoffIssue[],
  where: string,
): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = parseFeetInches(raw);
  if (v === null || v < 0) {
    issues.push({ severity: "warning", where, message: `Unparseable ${what}: "${raw}"` });
    return null;
  }
  return v;
}

const SQFT_PER_UNIT: Record<NonNullable<RawMeasurement["dims"]>["valueUnit"] & string, number> = {
  LF: 1, // length passthrough (handled per-kind below)
  SF: 1,
  SY: 9,
  CY: 1, // volume passthrough
  CF: 1 / 27, // cubic feet → CY
};

/**
 * Step 4 core: turn one classified/transcribed item into an exact quantity.
 * Every arithmetic path below is local TS — the model's numbers are only ever
 * copied strings and integer counts.
 */
export function normalizeMeasurement(
  raw: RawMeasurement,
  ctx: { sheetRef: string; calibration: ScaleCalibration | null; issues: TakeoffIssue[] },
): Measurement | null {
  const where = `${ctx.sheetRef} — ${raw.label}`;
  const issues = ctx.issues;
  const assumptions: string[] = [];
  if (raw.source === "estimated") {
    assumptions.push("Model flagged this item as estimated (no printed dimension) — verify.");
  }

  const count = raw.count !== undefined ? Math.max(0, Math.round(Number(raw.count))) : undefined;

  const finish = (quantity: number, basis: string): Measurement | null => {
    if (!Number.isFinite(quantity) || quantity < 0) {
      issues.push({ severity: "warning", where, message: `Non-finite quantity from ${basis}` });
      return null;
    }
    return {
      kind: raw.kind,
      quantity,
      unit: KIND_UNIT[raw.kind],
      trade: raw.trade,
      assemblyId: raw.assembly,
      label: raw.label,
      sheetRef: ctx.sheetRef,
      basis,
      source: raw.source,
      assumptions,
    };
  };

  const tracedLengthFt = (): number | null => {
    if (!raw.pixels || raw.pixels.vertices.length < 2) return null;
    if (!ctx.calibration) {
      issues.push({
        severity: "error",
        where,
        message: "Traced geometry supplied but sheet has no usable scale (NTS/missing) — skipped.",
      });
      return null;
    }
    return ctx.calibration.lengthFt(polylineLengthPx(raw.pixels.vertices));
  };

  const tracedAreaSf = (): number | null => {
    if (!raw.pixels || raw.pixels.vertices.length < 3) return null;
    if (!ctx.calibration) {
      issues.push({
        severity: "error",
        where,
        message: "Traced geometry supplied but sheet has no usable scale (NTS/missing) — skipped.",
      });
      return null;
    }
    return ctx.calibration.areaSf(polygonAreaPx(raw.pixels.vertices));
  };

  const L = toFt(raw.dims?.length, "length", issues, where);
  const W = toFt(raw.dims?.width, "width", issues, where);
  const H = toFt(raw.dims?.height, "height", issues, where);
  const D = toFt(raw.dims?.depth, "depth", issues, where);
  const explicit =
    raw.dims?.value !== undefined ? parseNumberWithFraction(String(raw.dims.value).replace(/,/g, "")) : null;

  switch (raw.kind) {
    case "count": {
      if (count === undefined) {
        issues.push({ severity: "warning", where, message: "Count item without a count — skipped." });
        return null;
      }
      return finish(count, `counted ${count} on drawing`);
    }

    case "length": {
      const n = count ?? 1;
      if (explicit !== null && raw.dims?.valueUnit === "LF") {
        return finish(explicit * n, `printed value ${explicit} LF × ${n}`);
      }
      if (L !== null) {
        return finish(L * n, `dimension ${raw.dims?.length} → ${L.toFixed(2)} ft × ${n}`);
      }
      const traced = tracedLengthFt();
      if (traced !== null) {
        return finish(
          traced * n,
          `traced polyline ${polylineLengthPx(raw.pixels!.vertices).toFixed(0)}px × ${ctx.calibration!.feetPerPixel.toExponential(3)} ft/px × ${n}`,
        );
      }
      issues.push({ severity: "warning", where, message: "Length item with no usable dimension — skipped." });
      return null;
    }

    case "area": {
      const n = count ?? 1;
      if (explicit !== null && (raw.dims?.valueUnit === "SF" || raw.dims?.valueUnit === "SY")) {
        const sf = explicit * SQFT_PER_UNIT[raw.dims.valueUnit];
        return finish(sf * n, `printed value ${explicit} ${raw.dims.valueUnit} → ${sf.toFixed(1)} SF × ${n}`);
      }
      // Wall elevations: length × height. Plans: length × width.
      const a = L !== null && W !== null ? L * W : L !== null && H !== null ? L * H : null;
      if (a !== null) {
        const second = W !== null ? `${raw.dims?.width}` : `${raw.dims?.height}`;
        return finish(a * n, `${raw.dims?.length} × ${second} → ${a.toFixed(1)} SF × ${n}`);
      }
      const traced = tracedAreaSf();
      if (traced !== null) {
        return finish(traced * n, `traced polygon (shoelace) → ${traced.toFixed(1)} SF × ${n}`);
      }
      issues.push({ severity: "warning", where, message: "Area item with no usable dimensions — skipped." });
      return null;
    }

    case "volume": {
      const n = count ?? 1;
      if (explicit !== null && raw.dims?.valueUnit === "CY") {
        return finish(explicit * n, `printed value ${explicit} CY × ${n}`);
      }
      if (explicit !== null && raw.dims?.valueUnit === "CF") {
        const cy = explicit / 27;
        return finish(cy * n, `printed value ${explicit} CF → ${cy.toFixed(2)} CY × ${n}`);
      }
      const depth = D ?? H;
      let baseSf: number | null = null;
      let baseBasis = "";
      if (L !== null && W !== null) {
        baseSf = L * W;
        baseBasis = `${raw.dims?.length} × ${raw.dims?.width}`;
      } else if (explicit !== null && raw.dims?.valueUnit === "SF") {
        baseSf = explicit;
        baseBasis = `printed area ${explicit} SF`;
      } else {
        const traced = tracedAreaSf();
        if (traced !== null) {
          baseSf = traced;
          baseBasis = "traced polygon";
        }
      }
      if (baseSf !== null && depth !== null) {
        const cy = (baseSf * depth) / 27;
        return finish(
          cy * n,
          `${baseBasis} × depth ${raw.dims?.depth ?? raw.dims?.height} → ${(baseSf * depth).toFixed(1)} CF ÷ 27 = ${cy.toFixed(2)} CY × ${n}`,
        );
      }
      issues.push({
        severity: "warning",
        where,
        message: "Volume item missing area and/or depth — skipped.",
      });
      return null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Step 5 — assemblies: measurement → material quantities              */
/* ------------------------------------------------------------------ */

export type MaterialLine = {
  description: string;
  unit: PurchaseUnit;
  /** Exact (fractional) quantity INCLUDING waste — pre-rounding. */
  quantityExact: number;
  /** Purchasable quantity — ceil'd AFTER merging identical lines. */
  quantityPurchase: number;
  wastePct: number;
  csiDivision: CsiDivision;
  csiTitle: string;
  trade: Trade;
  /** Which measurement(s) drove this line. */
  basis: string;
  assumptions: string[];
};

type LineSpec = Omit<MaterialLine, "quantityPurchase" | "csiTitle" | "trade" | "basis">;

export type AssemblyDefinition = {
  id: string;
  label: string;
  trade: Trade;
  appliesTo: MeasurementKind;
  csiDivision: CsiDivision;
  /** Tunable factors an estimator can override per company standards. */
  defaults: Record<string, number>;
  /** Pure function: normalized quantity (canonical unit) → material lines. */
  compute: (quantity: number, p: Record<string, number>) => LineSpec[];
};

const line = (
  description: string,
  unit: PurchaseUnit,
  quantityExact: number,
  wastePct: number,
  csiDivision: CsiDivision,
  assumptions: string[] = [],
): LineSpec => ({ description, unit, quantityExact, wastePct, csiDivision, assumptions });

function formatInches(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const whole = Math.floor(value);
  let eighths = Math.round((value - whole) * 8);
  if (eighths === 8) return `${whole + 1}"`;
  if (eighths === 0) return `${whole}"`;
  const divisor = eighths % 4 === 0 ? 4 : eighths % 2 === 0 ? 2 : 1;
  eighths /= divisor;
  const denominator = 8 / divisor;
  return whole > 0 ? `${whole} ${eighths}/${denominator}"` : `${eighths}/${denominator}"`;
}

/**
 * The assembly registry. Factors are industry rules of thumb, declared once,
 * overridable via `params` — and every line records its assumptions so the
 * estimator can audit rather than trust.
 */
export const ASSEMBLIES: readonly AssemblyDefinition[] = [
  {
    id: "drywall-wall",
    label: "Gypsum board wall finish (one side)",
    trade: "drywall",
    appliesTo: "area",
    csiDivision: "09",
    // Rules of thumb per 1000 SF of board: ~1000 screws (16" o.c. framing),
    // ~370 LF joint tape, ~138 lb joint compound.
    defaults: { wastePct: 10, panelSf: 32, screwsPerSf: 1, tapeLfPerSf: 0.37, mudLbPerSf: 0.138 },
    compute: (sf, p) => {
      const waste = 1 + p.wastePct / 100;
      const panels = (sf * waste) / p.panelSf;
      const screws = sf * p.screwsPerSf;
      const tapeRolls = (sf * p.tapeLfPerSf) / 250; // 250 LF/roll
      const mudPails = (sf * p.mudLbPerSf) / 61.7; // 4.5-gal pail ≈ 61.7 lb
      return [
        line(`5/8" Type X gypsum board 4'×8' (${p.panelSf} SF)`, "SHEET", panels, p.wastePct, "09"),
        line('1-1/4" drywall screws (box of 1,000)', "BOX", screws / 1000, 0, "09", [
          `${p.screwsPerSf} screw/SF @ 16" o.c. framing`,
        ]),
        line("Paper joint tape (250' roll)", "ROLL", tapeRolls, 0, "09", [
          `${p.tapeLfPerSf} LF tape per SF of board`,
        ]),
        line("All-purpose joint compound (4.5-gal pail)", "PAIL", mudPails, 0, "09", [
          `${p.mudLbPerSf} lb compound per SF of board`,
        ]),
      ];
    },
  },
  {
    id: "metal-stud-wall",
    label: "Metal stud partition framing",
    trade: "framing",
    appliesTo: "length",
    csiDivision: "09",
    defaults: { studSpacingIn: 16, extrasPct: 15, wallHeightFt: 9, trackStickFt: 10, studSizeIn: 3.625 },
    compute: (lf, p) => {
      // Studs: one per spacing along the run, +1 to close the run, plus an
      // extras allowance for corners, intersections, and opening jambs.
      const studs = (Math.ceil((lf * 12) / p.studSpacingIn) + 1) * (1 + p.extrasPct / 100);
      const trackSticks = (lf * 2) / p.trackStickFt; // top + bottom track
      return [
        line(
          `3-5/8" 25ga metal studs × ${p.wallHeightFt}' (${p.studSpacingIn}" o.c.)`,
          "EA",
          studs,
          p.extrasPct,
          "09",
          [`+${p.extrasPct}% for corners/intersections/openings`],
        ),
        line(`3-5/8" 25ga track (${p.trackStickFt}' stick)`, "STICK", trackSticks, 0, "09", [
          "Top + bottom track = 2 × wall length",
        ]),
        line("Framing screws / fasteners (box of 1,000)", "BOX", (lf * 12) / p.studSpacingIn / 250, 0, "09", [
          "≈4 fasteners per stud",
        ]),
      ];
    },
  },
  {
    id: "wood-stud-wall",
    label: "Wood stud wall framing",
    trade: "framing",
    appliesTo: "length",
    csiDivision: "06",
    defaults: { studSpacingIn: 16, extrasPct: 15, plateCount: 3, plateStickFt: 16 },
    compute: (lf, p) => {
      const studs = (Math.ceil((lf * 12) / p.studSpacingIn) + 1) * (1 + p.extrasPct / 100);
      const plateSticks = (lf * p.plateCount) / p.plateStickFt;
      return [
        line(`2×4 precut studs (${p.studSpacingIn}" o.c.)`, "EA", studs, p.extrasPct, "06", [
          `+${p.extrasPct}% for corners/openings`,
        ]),
        line(`2×4×${p.plateStickFt}' plate stock`, "STICK", plateSticks, 0, "06", [
          `${p.plateCount} plates (1 bottom + double top)`,
        ]),
        line("16d framing nails (50 lb box)", "BOX", lf / 200, 0, "06", ["≈1 box per 200 LF of wall"]),
      ];
    },
  },
  {
    id: "paint-wall",
    label: "Interior paint (walls)",
    trade: "paint",
    appliesTo: "area",
    csiDivision: "09",
    defaults: { coats: 2, coverageSfPerGal: 350, primerCoverageSfPerGal: 300, includePrimer: 1 },
    compute: (sf, p) => {
      const out: LineSpec[] = [
        line("Interior latex paint", "GAL", (sf * p.coats) / p.coverageSfPerGal, 0, "09", [
          `${p.coats} coats @ ${p.coverageSfPerGal} SF/gal`,
        ]),
      ];
      if (p.includePrimer) {
        out.push(
          line("PVA primer", "GAL", sf / p.primerCoverageSfPerGal, 0, "09", [
            `1 coat @ ${p.primerCoverageSfPerGal} SF/gal`,
          ]),
        );
      }
      return out;
    },
  },
  {
    id: "batt-insulation",
    label: "Batt insulation in framed wall",
    trade: "insulation",
    appliesTo: "area",
    csiDivision: "07",
    defaults: { wastePct: 5, coverageSfPerBag: 64 },
    compute: (sf, p) => [
      line("R-13 kraft-faced batts", "BAG", (sf * (1 + p.wastePct / 100)) / p.coverageSfPerBag, p.wastePct, "07", [
        `${p.coverageSfPerBag} SF/bag — confirm against the spec'd R-value/width`,
      ]),
    ],
  },
  {
    id: "concrete-slab",
    label: "Concrete slab on grade",
    trade: "concrete",
    appliesTo: "volume",
    csiDivision: "03",
    defaults: { wastePct: 8, meshSheetSf: 50, meshLapPct: 15, vbRollSf: 1000, vbLapPct: 10 },
    compute: (cy, p) => {
      const slabSf = p.slabSf ?? cy * 81;
      return [
        line("Ready-mix concrete 3000 PSI", "CY", cy * (1 + p.wastePct / 100), p.wastePct, "03", [
          "Round final order to supplier increment (typically 0.25–0.5 CY)",
        ]),
        line(`6×6 W1.4 WWM sheet (${p.meshSheetSf} SF)`, "SHEET", (slabSf * (1 + p.meshLapPct / 100)) / p.meshSheetSf, p.meshLapPct, "03", [
          p.slabSf ? "Slab area supplied by takeoff engine" : '4" slab equivalence (81 SF/CY) — recompute if thickness differs',
        ]),
        line("10-mil vapor barrier (1,000 SF roll)", "ROLL", (slabSf * (1 + p.vbLapPct / 100)) / p.vbRollSf, p.vbLapPct, "03", [
          p.slabSf ? "Slab area supplied by takeoff engine" : '4" slab equivalence (81 SF/CY)',
        ]),
      ];
    },
  },
  {
    id: "pipe-run",
    label: "Pressure pipe run",
    trade: "plumbing",
    appliesTo: "length",
    csiDivision: "22",
    defaults: { wastePct: 5, stickFt: 20, hangerSpacingFt: 4, fittingsPerStick: 1 },
    compute: (lf, p) => {
      const sticks = (lf * (1 + p.wastePct / 100)) / p.stickFt;
      return [
        line(`Pipe (${p.stickFt}' stick)`, "STICK", sticks, p.wastePct, "22", [
          "Size/material per plan callout — carried as generic until spec'd",
        ]),
        line("Couplings / fittings allowance", "EA", sticks * p.fittingsPerStick, 0, "22", [
          `${p.fittingsPerStick} fitting per stick average`,
        ]),
        line("Pipe hangers", "EA", lf / p.hangerSpacingFt, 0, "22", [
          `1 hanger per ${p.hangerSpacingFt} LF`,
        ]),
      ];
    },
  },
  {
    id: "plumbing-fixture",
    label: "Plumbing fixture set",
    trade: "plumbing",
    appliesTo: "count",
    csiDivision: "22",
    defaults: { stopsPerFixture: 2, supplyLinesPerFixture: 2 },
    compute: (ea, p) => [
      line("Fixture (per schedule)", "EA", ea, 0, "22"),
      line("Rough-in kit", "KIT", ea, 0, "22"),
      line("Angle stops", "EA", ea * p.stopsPerFixture, 0, "22"),
      line("Braided supply lines", "EA", ea * p.supplyLinesPerFixture, 0, "22"),
    ],
  },
  {
    id: "vct-flooring",
    label: "VCT flooring",
    trade: "flooring",
    appliesTo: "area",
    csiDivision: "09",
    defaults: { wastePct: 10, tileSf: 1, boxSf: 45, adhesiveSfPerGal: 150 },
    compute: (sf, p) => [
      line(`12"×12" VCT (${p.boxSf} SF box)`, "BOX", (sf * (1 + p.wastePct / 100)) / p.boxSf, p.wastePct, "09"),
      line("VCT adhesive", "GAL", sf / p.adhesiveSfPerGal, 0, "09", [
        `${p.adhesiveSfPerGal} SF/gal coverage`,
      ]),
    ],
  },
] as const;

const ASSEMBLY_BY_ID: Map<string, AssemblyDefinition> = new Map(ASSEMBLIES.map((a) => [a.id, a]));
const metalStudWallAssembly = ASSEMBLY_BY_ID.get("metal-stud-wall");
if (metalStudWallAssembly) {
  ASSEMBLY_BY_ID.set("metal-stud-wall", {
    ...metalStudWallAssembly,
    compute: (lf, p) => {
      const studs = (Math.ceil((lf * 12) / p.studSpacingIn) + 1) * (1 + p.extrasPct / 100);
      const trackSticks = (lf * 2) / p.trackStickFt;
      const studSize = formatInches(p.studSizeIn) || '3 5/8"';
      return [
        line(`${studSize} 25ga metal studs x ${p.wallHeightFt}' (${p.studSpacingIn}" o.c.)`, "EA", studs, p.extrasPct, "09", [
          `+${p.extrasPct}% for corners/intersections/openings`,
        ]),
        line(`${studSize} 25ga track (${p.trackStickFt}' stick)`, "STICK", trackSticks, 0, "09", [
          "Top + bottom track = 2 x wall length",
        ]),
        line("Framing screws / fasteners (box of 1,000)", "BOX", (lf * 12) / p.studSpacingIn / 250, 0, "09", [
          "approx. 4 fasteners per stud",
        ]),
      ];
    },
  });
}

/** Fallback when the model didn't name an assembly: default by trade+kind. */
export const DEFAULT_ASSEMBLY: Partial<Record<`${Trade}:${MeasurementKind}`, string>> = {
  "drywall:area": "drywall-wall",
  "framing:length": "metal-stud-wall",
  "paint:area": "paint-wall",
  "insulation:area": "batt-insulation",
  "concrete:volume": "concrete-slab",
  "plumbing:length": "pipe-run",
  "plumbing:count": "plumbing-fixture",
  "flooring:area": "vct-flooring",
};

export function listAssemblies(): { id: string; label: string; trade: Trade; appliesTo: MeasurementKind }[] {
  return ASSEMBLIES.map((a) => ({ id: a.id, label: a.label, trade: a.trade, appliesTo: a.appliesTo }));
}

/**
 * Step 5 core: measurement → material lines through the matched assembly.
 * A measurement with no matching assembly is NOT dropped — it passes through
 * as a raw quantity line so the estimator always sees 100% of what was taken
 * off.
 */
export function runAssembly(
  m: Measurement,
  overrides: Record<string, Record<string, number>> = {},
  issues: TakeoffIssue[] = [],
): MaterialLine[] {
  const id = m.assemblyId ?? DEFAULT_ASSEMBLY[`${m.trade}:${m.kind}`];
  const asm = id ? ASSEMBLY_BY_ID.get(id) : undefined;

  if (asm && asm.appliesTo !== m.kind) {
    issues.push({
      severity: "warning",
      where: `${m.sheetRef} — ${m.label}`,
      message: `Assembly "${asm.id}" expects a ${asm.appliesTo} but got a ${m.kind} — passed through raw.`,
    });
  }

  if (!asm || asm.appliesTo !== m.kind) {
    return [
      {
        description: `${m.label} (raw ${m.kind})`,
        unit: m.unit,
        quantityExact: m.quantity,
        quantityPurchase: Math.ceil(m.quantity),
        wastePct: 0,
        csiDivision: TRADE_DEFAULT_DIVISION[m.trade],
        csiTitle: CSI_DIVISIONS[TRADE_DEFAULT_DIVISION[m.trade]],
        trade: m.trade,
        basis: m.basis,
        assumptions: [...m.assumptions, "No assembly matched — raw quantity passed to estimator."],
      },
    ];
  }

  const params = { ...asm.defaults, ...(overrides[asm.id] ?? {}), ...(m.assemblyParams ?? {}) };
  return asm.compute(m.quantity, params).map((spec) => ({
    ...spec,
    quantityPurchase: Math.ceil(spec.quantityExact), // re-ceil'd after merge
    csiTitle: CSI_DIVISIONS[spec.csiDivision],
    trade: m.trade,
    basis: `${m.label}: ${m.basis}`,
    assumptions: [...m.assumptions, ...spec.assumptions],
  }));
}

/* ------------------------------------------------------------------ */
/* Step 6 — organize; Step 7 — pricing handoff                          */
/* ------------------------------------------------------------------ */

export type TradeSection = {
  trade: Trade;
  materials: MaterialLine[];
};

export type DivisionSection = {
  division: CsiDivision;
  divisionTitle: string;
  trades: TradeSection[];
};

export type SheetSummary = {
  fileName: string;
  pageNumber: number;
  sheetId?: string;
  sheetTitle?: string;
  scale: string;
  measurementCount: number;
};

export type TakeoffReport = {
  generatedAt: string;
  scope: TradeScope;
  sheets: SheetSummary[];
  measurements: Measurement[];
  /** Quantities only — organized Division → Trade → merged material lines.
   *  Pricing is deliberately absent here (step 7 separation). */
  divisions: DivisionSection[];
  issues: TakeoffIssue[];
  usage: { fileName: string; model: string; inputTokens: number; outputTokens: number }[];
};

export function mergeLines(lines: MaterialLine[]): MaterialLine[] {
  const merged = new Map<string, MaterialLine>();
  for (const l of lines) {
    const key = `${l.csiDivision}::${l.trade}::${l.description.toLowerCase()}::${l.unit}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantityExact += l.quantityExact;
      existing.basis = `${existing.basis}; ${l.basis}`;
      for (const a of l.assumptions) {
        if (!existing.assumptions.includes(a)) existing.assumptions.push(a);
      }
    } else {
      merged.set(key, { ...l, assumptions: [...l.assumptions] });
    }
  }
  // Purchasable rounding happens ONCE, after merging — rounding per-wall then
  // summing would systematically over-buy.
  return Array.from(merged.values()).map((l) => ({
    ...l,
    quantityExact: Number(l.quantityExact.toFixed(3)),
    quantityPurchase: Math.ceil(l.quantityExact - 1e-9),
  }));
}

export function organizeReport(lines: MaterialLine[]): DivisionSection[] {
  const byDivision = new Map<CsiDivision, Map<Trade, MaterialLine[]>>();
  for (const l of lines) {
    if (!byDivision.has(l.csiDivision)) byDivision.set(l.csiDivision, new Map());
    const tradeMap = byDivision.get(l.csiDivision)!;
    if (!tradeMap.has(l.trade)) tradeMap.set(l.trade, []);
    tradeMap.get(l.trade)!.push(l);
  }
  return Array.from(byDivision.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, tradeMap]) => ({
      division,
      divisionTitle: CSI_DIVISIONS[division],
      trades: Array.from(tradeMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([trade, materials]) => ({
          trade,
          materials: materials.sort((x, y) => x.description.localeCompare(y.description)),
        })),
    }));
}

export function buildReportFromMeasurements(
  measurements: Measurement[],
  opts: {
    sheets: SheetSummary[];
    scope?: TradeScope;
    assemblyOverrides?: Record<string, Record<string, number>>;
    issues?: TakeoffIssue[];
  },
): TakeoffReport {
  const issues = [...(opts.issues ?? [])];
  const scoped = measurements.filter((m) => inScope(m.trade, opts.scope));
  const lines = scoped.flatMap((m) => runAssembly(m, opts.assemblyOverrides ?? {}, issues));
  const divisions = organizeReport(mergeLines(lines));

  return {
    generatedAt: new Date().toISOString(),
    scope: opts.scope ?? {},
    sheets: opts.sheets,
    measurements: scoped,
    divisions,
    issues,
    usage: [],
  };
}

/* ------------------------------------------------------------------ */
/* Step 7 — hand off to estimating                                      */
/* ------------------------------------------------------------------ */

export type Rate = {
  /** Material unit cost, in dollars per purchase unit. */
  materialUnitCost?: number;
  /** Labor unit cost, in dollars per purchase unit. */
  laborUnitCost?: number;
};

export type RateTable = {
  /** Keyed by lowercase material description; first match wins. */
  byDescription: Record<string, Rate>;
  /** Markups applied at the summary level, not baked into lines. */
  overheadPct?: number;
  profitPct?: number;
  salesTaxPct?: number;
};

export type PricedLine = MaterialLine & {
  materialUnitCost: number | null;
  laborUnitCost: number | null;
  materialExtended: number | null;
  laborExtended: number | null;
};

export type PricedTakeoffReport = {
  report: TakeoffReport;
  lines: PricedLine[];
  unpricedCount: number;
  subtotals: { material: number; labor: number };
  salesTax: number;
  overhead: number;
  profit: number;
  total: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic pricing application. Quantities (from the report) and rates
 * (from the caller — pricing DB, vendor quotes, or hand entry) stay separate
 * data structures until this explicit join; unpriced lines are surfaced, not
 * hidden, so the estimate is never silently short.
 */
export function applyPricing(report: TakeoffReport, rates: RateTable): PricedTakeoffReport {
  const allLines = report.divisions.flatMap((d) => d.trades.flatMap((t) => t.materials));
  const lines: PricedLine[] = allLines.map((l) => {
    const rate = rates.byDescription[l.description.toLowerCase()];
    const materialUnitCost = rate?.materialUnitCost ?? null;
    const laborUnitCost = rate?.laborUnitCost ?? null;
    return {
      ...l,
      materialUnitCost,
      laborUnitCost,
      materialExtended:
        materialUnitCost !== null ? round2(materialUnitCost * l.quantityPurchase) : null,
      laborExtended: laborUnitCost !== null ? round2(laborUnitCost * l.quantityPurchase) : null,
    };
  });

  const material = round2(lines.reduce((s, l) => s + (l.materialExtended ?? 0), 0));
  const labor = round2(lines.reduce((s, l) => s + (l.laborExtended ?? 0), 0));
  const salesTax = round2(material * ((rates.salesTaxPct ?? 0) / 100));
  const overhead = round2((material + labor + salesTax) * ((rates.overheadPct ?? 0) / 100));
  const profit = round2((material + labor + salesTax + overhead) * ((rates.profitPct ?? 0) / 100));

  return {
    report,
    lines,
    unpricedCount: lines.filter((l) => l.materialUnitCost === null && l.laborUnitCost === null).length,
    subtotals: { material, labor },
    salesTax,
    overhead,
    profit,
    total: round2(material + labor + salesTax + overhead + profit),
  };
}
