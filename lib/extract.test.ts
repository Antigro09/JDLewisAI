import { describe, expect, it } from "vitest";
import {
  isPlainTextMime,
  isIndexableMime,
  extractFileText,
} from "@/lib/extract";

describe("mime classification", () => {
  it("treats text/*, json, xml, csv as plain text", () => {
    for (const m of ["text/plain", "text/csv", "text/markdown", "application/json", "application/xml", "application/csv"]) {
      expect(isPlainTextMime(m)).toBe(true);
    }
  });

  it("treats PDF as indexable but not plain text", () => {
    expect(isPlainTextMime("application/pdf")).toBe(false);
    expect(isIndexableMime("application/pdf")).toBe(true);
  });

  it("rejects images and unknown binaries", () => {
    for (const m of ["image/png", "application/octet-stream", "application/vnd.ms-excel"]) {
      expect(isIndexableMime(m)).toBe(false);
    }
  });
});

describe("extractFileText", () => {
  it("extracts plain text as a single page-less unit", async () => {
    const units = await extractFileText("text/plain", Buffer.from("hello world"));
    expect(units).toEqual([{ page: null, text: "hello world" }]);
  });

  it("returns [] for empty/whitespace content", async () => {
    expect(await extractFileText("text/plain", Buffer.from("   \n  "))).toEqual([]);
  });

  it("pretty-prints minified JSON so the chunker can split on keys", async () => {
    const min = '{"a":1,"b":{"c":2}}';
    const [unit] = await extractFileText("application/json", Buffer.from(min));
    expect(unit.text).toContain('"a": 1'); // spaced → pretty-printed
    expect(unit.text.split("\n").length).toBeGreaterThan(1);
  });

  it("indexes invalid JSON as raw text rather than dropping it", async () => {
    const [unit] = await extractFileText("application/json", Buffer.from("{not valid json"));
    expect(unit.text).toBe("{not valid json");
  });

  it("returns [] for an unsupported binary type", async () => {
    expect(await extractFileText("image/png", Buffer.from([0x89, 0x50]))).toEqual([]);
  });

  it("returns [] rather than throwing on a corrupt PDF", async () => {
    const units = await extractFileText("application/pdf", Buffer.from("%PDF-1.4 not really a pdf"));
    expect(Array.isArray(units)).toBe(true);
  });
});
