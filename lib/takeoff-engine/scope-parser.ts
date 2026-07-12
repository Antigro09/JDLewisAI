import type { EngineSheet, TakeoffScope, TakeoffScopeRequest, TakeoffTrade } from "./types";

const SHEET_REF_RE = /\b[A-Z]{1,3}(?:\s*[-.]?\s*)?\d{1,4}(?:[.-]\d+)?(?![.-]\d)\b/gi;
const PAGE_REF_RE = /\b(?:page|pg)\s*(\d{1,4})\b/gi;

const TRADE_PATTERNS: [TakeoffTrade, RegExp][] = [
  ["doors", /\bdoors?\b/i],
  ["flooring", /\b(?:floor(?:ing)?|finish(?:es)?|vct|tile|carpet)\b/i],
  ["columns", /\bcolumns?\b/i],
  ["walls", /\bwalls?\b/i],
];
const TRADES = new Set<TakeoffTrade>(["walls", "doors", "flooring", "columns"]);

type RefMatch = {
  ref: string;
  index: number;
  end: number;
};

function normRef(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "").replace(/-/g, ".");
}

function refMatchesFromText(text: string): RefMatch[] {
  const matches: RefMatch[] = [];
  for (const match of text.matchAll(SHEET_REF_RE)) {
    matches.push({
      ref: normRef(match[0]),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  for (const match of text.matchAll(PAGE_REF_RE)) {
    matches.push({
      ref: match[1],
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return matches.sort((a, b) => a.index - b.index);
}

function refsFromText(text: string): string[] {
  const refs = new Set<string>();
  for (const match of refMatchesFromText(text)) refs.add(match.ref);
  return [...refs];
}

function tradesFromText(text: string): TakeoffTrade[] {
  return TRADE_PATTERNS
    .map(([trade, pattern], order) => {
      const match = pattern.exec(text);
      return match ? { trade, index: match.index, order } : null;
    })
    .filter((match): match is { trade: TakeoffTrade; index: number; order: number } => match !== null)
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .map((match) => match.trade);
}

function sheetIdsForRefs(refs: string[], sheets: EngineSheet[]): string[] {
  const wanted = new Set(refs.map(normRef));
  return sheets
    .filter((sheet) => {
      const sheetNumber = sheet.sheet_number ? normRef(sheet.sheet_number) : "";
      const page = String(sheet.page_number);
      return wanted.has(sheetNumber) || wanted.has(page);
    })
    .map((sheet) => sheet.id);
}

function isTrade(value: unknown): value is TakeoffTrade {
  return typeof value === "string" && TRADES.has(value as TakeoffTrade);
}

export function normalizeTakeoffScope(
  instructions: string,
  value: unknown,
  sheets: EngineSheet[],
): TakeoffScope {
  const rawRequests = Array.isArray((value as TakeoffScope | null)?.requests)
    ? (value as TakeoffScope).requests
    : [];
  const requests: TakeoffScopeRequest[] = [];
  for (const raw of rawRequests) {
    if (!raw || typeof raw !== "object") continue;
    const trade = (raw as Partial<TakeoffScopeRequest>).trade;
    if (!isTrade(trade)) continue;
    const refs = Array.isArray((raw as Partial<TakeoffScopeRequest>).sheet_refs)
      ? (raw as Partial<TakeoffScopeRequest>).sheet_refs!.filter((ref): ref is string => typeof ref === "string").map(normRef)
      : [];
    const sheetIds = Array.isArray((raw as Partial<TakeoffScopeRequest>).sheet_ids)
      ? (raw as Partial<TakeoffScopeRequest>).sheet_ids!.filter((id): id is string => typeof id === "string")
      : [];
    requests.push({
      trade,
      sheet_refs: [...new Set(refs)],
      sheet_ids: [...new Set([...sheetIds, ...sheetIdsForRefs(refs, sheets)])],
      include_existing: Boolean((raw as Partial<TakeoffScopeRequest>).include_existing),
    });
  }
  return { instructions: instructions.trim(), requests };
}

export function parseTakeoffScope(instructions: string, sheets: EngineSheet[]): TakeoffScope {
  const cleaned = instructions.trim();
  const globalRefs = refsFromText(cleaned);
  const requests: TakeoffScopeRequest[] = [];
  const clauses = cleaned.split(/[;\n]|\.(?=\s|$)/i).map((part) => part.trim()).filter(Boolean);
  const includeExisting = /\binclude\s+existing\b/i.test(cleaned);
  const pushRequest = (trade: TakeoffTrade, refs: string[]) => {
    requests.push({
      trade,
      sheet_refs: refs,
      sheet_ids: sheetIdsForRefs(refs, sheets),
      include_existing: includeExisting,
    });
  };

  for (const clause of clauses.length ? clauses : [cleaned]) {
    const clauseRefMatches = refMatchesFromText(clause);
    const clauseTrades = tradesFromText(clause);
    if (clauseTrades.length === 0) continue;

    if (clauseRefMatches.length <= 1) {
      const refs = clauseRefMatches.length ? [clauseRefMatches[0].ref] : globalRefs;
      for (const trade of clauseTrades) pushRequest(trade, refs);
      continue;
    }

    let segmentStart = 0;
    let lastTrades: TakeoffTrade[] = [];
    for (const ref of clauseRefMatches) {
      const segmentTrades = tradesFromText(clause.slice(segmentStart, ref.index));
      const trades = segmentTrades.length ? segmentTrades : lastTrades.length ? lastTrades : clauseTrades;
      for (const trade of trades) pushRequest(trade, [ref.ref]);
      if (segmentTrades.length) lastTrades = segmentTrades;
      segmentStart = ref.end;
    }
  }

  if (requests.length === 0 && globalRefs.length > 0) {
    for (const trade of ["walls", "doors", "flooring", "columns"] as const) {
      requests.push({
        trade,
        sheet_refs: globalRefs,
        sheet_ids: sheetIdsForRefs(globalRefs, sheets),
        include_existing: includeExisting,
      });
    }
  }

  return { instructions: cleaned, requests };
}
