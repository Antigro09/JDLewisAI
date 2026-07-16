import { describe, expect, it } from "vitest";
import {
  packLines,
  packCsvLines,
  chunkExtractedText,
  rrfMerge,
  escapeLike,
  CHUNK_CHARS,
  CHUNK_OVERLAP,
} from "@/lib/retrieval";

// These are the pure retrieval building blocks — no DB, no embeddings. They
// pin the behaviors the audit flagged: overlap across chunk boundaries, CSV
// header propagation, RRF fusion, and LIKE-wildcard escaping.

describe("packLines", () => {
  it("keeps a short document as a single chunk", () => {
    expect(packLines(["one line", "two line"])).toEqual(["one line\ntwo line"]);
  });

  it("carries overlap context across a chunk boundary", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i} ${"x".repeat(30)}`);
    const chunks = packLines(lines);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk stays within budget.
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
    // The tail of chunk N reappears at the head of chunk N+1 (overlap).
    const firstTail = chunks[0].split("\n").slice(-1)[0];
    expect(chunks[1]).toContain(firstTail);
  });

  it("windows an overlong single line with overlap, never exceeding the budget", () => {
    const long = "word ".repeat(1000).trim(); // ~5000 chars, one line
    const chunks = packLines([long]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
    // Consecutive windows overlap, so no content falls in a boundary gap.
    expect(chunks[0].slice(-CHUNK_OVERLAP)).not.toEqual("");
  });

  it("trims and drops empty chunks", () => {
    expect(packLines(["", "   ", ""])).toEqual([]);
  });
});

describe("packCsvLines", () => {
  const header = "Activity,Description,Start,Finish";
  it("repeats the header at the top of every chunk", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `A${i},Task ${i},2026-08-0${i % 9},2026-08-1${i % 9}`);
    const chunks = packCsvLines([header, ...rows]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.startsWith(header)).toBe(true);
  });

  it("returns just the header (or nothing) for a header-only file", () => {
    expect(packCsvLines([header])).toEqual([header]);
    expect(packCsvLines([])).toEqual([]);
  });

  it("keeps each chunk within the budget", () => {
    const rows = Array.from({ length: 500 }, (_, i) => `A${i},d,s,f`);
    for (const c of packCsvLines([header, ...rows])) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
    }
  });
});

describe("chunkExtractedText", () => {
  it("maps every chunk to exactly one source page", () => {
    const chunks = chunkExtractedText([
      { page: 1, text: "alpha content on page one" },
      { page: 2, text: "beta content on page two" },
    ]);
    expect(chunks.find((c) => c.content.includes("alpha"))?.page).toBe(1);
    expect(chunks.find((c) => c.content.includes("beta"))?.page).toBe(2);
  });

  it("propagates the CSV header when csv:true", () => {
    const header = "col_a,col_b,col_c";
    const text = [
      header,
      ...Array.from({ length: 100 }, (_, i) => `${i},${"b".repeat(20)},${"c".repeat(20)}`),
    ].join("\n");
    const chunks = chunkExtractedText([{ page: null, text }], { csv: true });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.startsWith(header)).toBe(true);
  });

  it("does not force a header without csv:true", () => {
    const text = "header\n" + Array.from({ length: 100 }, (_, i) => `row ${i} ${"y".repeat(20)}`).join("\n");
    const chunks = chunkExtractedText([{ page: null, text }]);
    // Later chunks are plain rows, not header-prefixed.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1].content.startsWith("header")).toBe(false);
  });
});

describe("rrfMerge", () => {
  const key = (x: { id: string }) => x.id;

  it("ranks an item appearing high in multiple lists above single-list items", () => {
    const listA = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const listB = [{ id: "b" }, { id: "d" }, { id: "a" }];
    const fused = rrfMerge([listA, listB], key);
    // 'a' (ranks 1 and 3) and 'b' (ranks 2 and 1) beat single-list 'c'/'d'.
    const order = fused.map((f) => f.id);
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
  });

  it("deduplicates by key and sums contributions", () => {
    const fused = rrfMerge([[{ id: "x" }], [{ id: "x" }]], key);
    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeGreaterThan(0);
  });

  it("returns [] for empty input", () => {
    expect(rrfMerge([], key)).toEqual([]);
    expect(rrfMerge([[], []], key)).toEqual([]);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\path")).toBe("c:\\\\path");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("waterproofing")).toBe("waterproofing");
  });
});
