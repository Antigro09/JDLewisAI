/**
 * Retrieval-quality evaluation harness (spec §10). Pure metric functions plus
 * a small runner shape so a golden Q&A set can be scored against the live
 * retrieval pipeline. The metrics are dependency-free and unit-tested; the
 * runner (scripts/rag-eval.ts) wires them to a seeded project + real
 * embeddings and is run manually, not in CI.
 *
 * A "relevant" hit is judged by substring match: a golden case lists
 * `expectSubstrings` that at least one retrieved passage must contain. This is
 * deliberately simple and deterministic — no LLM judge in the metric layer, so
 * scores are reproducible.
 */

export type GoldenCase = {
  id: string;
  question: string;
  /** A retrieved passage is relevant if it contains ANY of these (case-insensitive). */
  expectSubstrings: string[];
  /** When true, the correct behavior is to retrieve nothing / answer "not found". */
  expectNoAnswer?: boolean;
};

export type RetrievedPassage = { content: string; fileName?: string };

/** Does any retrieved passage satisfy the case's expected substrings? */
export function caseHit(expectSubstrings: string[], passages: RetrievedPassage[]): boolean {
  const needles = expectSubstrings.map((s) => s.toLowerCase());
  return passages.some((p) => {
    const hay = `${p.fileName ?? ""}\n${p.content}`.toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
}

/** Rank (1-based) of the first relevant passage, or 0 if none. */
export function firstRelevantRank(
  expectSubstrings: string[],
  passages: RetrievedPassage[],
): number {
  const needles = expectSubstrings.map((s) => s.toLowerCase());
  for (let i = 0; i < passages.length; i++) {
    const hay = `${passages[i].fileName ?? ""}\n${passages[i].content}`.toLowerCase();
    if (needles.some((n) => hay.includes(n))) return i + 1;
  }
  return 0;
}

export type CaseResult = {
  id: string;
  hit: boolean;
  rank: number;
  reciprocalRank: number;
};

export type EvalReport = {
  total: number;
  hits: number;
  recall: number;
  /** Mean reciprocal rank over cases that expect an answer. */
  mrr: number;
  /** Fraction of expect-no-answer cases correctly returning nothing. */
  abstainAccuracy: number | null;
  cases: CaseResult[];
};

/** Score one golden case against the passages retrieved for it. */
export function scoreCase(gold: GoldenCase, passages: RetrievedPassage[]): CaseResult {
  if (gold.expectNoAnswer) {
    const abstained = passages.length === 0;
    return { id: gold.id, hit: abstained, rank: abstained ? 1 : 0, reciprocalRank: abstained ? 1 : 0 };
  }
  const rank = firstRelevantRank(gold.expectSubstrings, passages);
  return {
    id: gold.id,
    hit: rank > 0,
    rank,
    reciprocalRank: rank > 0 ? 1 / rank : 0,
  };
}

/** Aggregate per-case results into a report. */
export function aggregate(golds: GoldenCase[], results: CaseResult[]): EvalReport {
  const answerable = golds.filter((g) => !g.expectNoAnswer);
  const abstain = golds.filter((g) => g.expectNoAnswer);
  const byId = new Map(results.map((r) => [r.id, r]));

  const answerableResults = answerable.map((g) => byId.get(g.id)).filter(Boolean) as CaseResult[];
  const hits = answerableResults.filter((r) => r.hit).length;
  const mrrSum = answerableResults.reduce((s, r) => s + r.reciprocalRank, 0);

  const abstainResults = abstain.map((g) => byId.get(g.id)).filter(Boolean) as CaseResult[];
  const abstainHits = abstainResults.filter((r) => r.hit).length;

  return {
    total: golds.length,
    hits,
    recall: answerableResults.length ? hits / answerableResults.length : 0,
    mrr: answerableResults.length ? mrrSum / answerableResults.length : 0,
    abstainAccuracy: abstainResults.length ? abstainHits / abstainResults.length : null,
    cases: results,
  };
}
