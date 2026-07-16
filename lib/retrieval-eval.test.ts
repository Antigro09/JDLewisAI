import { describe, expect, it } from "vitest";
import {
  caseHit,
  firstRelevantRank,
  scoreCase,
  aggregate,
  type GoldenCase,
} from "@/lib/retrieval-eval";

const P = (content: string, fileName?: string) => ({ content, fileName });

describe("caseHit / firstRelevantRank", () => {
  it("matches substrings case-insensitively across content and filename", () => {
    const passages = [P("The membrane is applied", "A503.pdf"), P("waterProofing detail")];
    expect(caseHit(["waterproofing"], passages)).toBe(true);
    expect(caseHit(["A503"], passages)).toBe(true);
    expect(caseHit(["fire alarm"], passages)).toBe(false);
  });

  it("returns the 1-based rank of the first relevant passage", () => {
    const passages = [P("irrelevant"), P("mentions rebar #5"), P("rebar again")];
    expect(firstRelevantRank(["rebar"], passages)).toBe(2);
    expect(firstRelevantRank(["nope"], passages)).toBe(0);
  });
});

describe("scoreCase", () => {
  it("scores a normal answerable case by first-relevant rank", () => {
    const gold: GoldenCase = { id: "q1", question: "?", expectSubstrings: ["rebar"] };
    const r = scoreCase(gold, [P("x"), P("rebar here")]);
    expect(r).toMatchObject({ id: "q1", hit: true, rank: 2, reciprocalRank: 0.5 });
  });

  it("scores an abstain case as a hit only when nothing was retrieved", () => {
    const gold: GoldenCase = { id: "q2", question: "?", expectSubstrings: [], expectNoAnswer: true };
    expect(scoreCase(gold, []).hit).toBe(true);
    expect(scoreCase(gold, [P("something")]).hit).toBe(false);
  });
});

describe("aggregate", () => {
  it("computes recall, MRR, and abstain accuracy", () => {
    const golds: GoldenCase[] = [
      { id: "a", question: "?", expectSubstrings: ["alpha"] },
      { id: "b", question: "?", expectSubstrings: ["beta"] },
      { id: "c", question: "?", expectSubstrings: [], expectNoAnswer: true },
    ];
    const results = [
      scoreCase(golds[0], [P("alpha")]), // hit rank 1
      scoreCase(golds[1], [P("x"), P("y"), P("beta")]), // hit rank 3
      scoreCase(golds[2], []), // correct abstain
    ];
    const report = aggregate(golds, results);
    expect(report.recall).toBe(1); // both answerable found
    expect(report.mrr).toBeCloseTo((1 + 1 / 3) / 2, 5);
    expect(report.abstainAccuracy).toBe(1);
  });

  it("penalizes a miss in recall and MRR", () => {
    const golds: GoldenCase[] = [
      { id: "a", question: "?", expectSubstrings: ["alpha"] },
      { id: "b", question: "?", expectSubstrings: ["beta"] },
    ];
    const results = [scoreCase(golds[0], [P("alpha")]), scoreCase(golds[1], [P("nope")])];
    const report = aggregate(golds, results);
    expect(report.recall).toBe(0.5);
    expect(report.mrr).toBeCloseTo(0.5, 5);
    expect(report.abstainAccuracy).toBeNull();
  });
});
