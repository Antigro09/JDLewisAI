import { describe, expect, it } from "vitest";
import { normalizeUploadMime, uploadValidationError } from "@/lib/uploads";

describe("normalizeUploadMime", () => {
  it("maps a mislabeled Excel-CSV to text/csv by extension", () => {
    // Windows + Excel reports .csv as application/vnd.ms-excel.
    expect(normalizeUploadMime("schedule.csv", "application/vnd.ms-excel")).toBe("text/csv");
  });

  it("maps empty browser MIME to the extension mapping", () => {
    expect(normalizeUploadMime("notes.md", "")).toBe("text/markdown");
    expect(normalizeUploadMime("server.log", "")).toBe("text/plain");
  });

  it("keeps a valid indexable MIME the browser already provided", () => {
    expect(normalizeUploadMime("data.json", "application/json")).toBe("application/json");
    expect(normalizeUploadMime("plans.pdf", "application/pdf")).toBe("application/pdf");
  });

  it("falls back to octet-stream for unknown, unlabeled files", () => {
    expect(normalizeUploadMime("mystery.bin", "")).toBe("application/octet-stream");
  });

  it("does not override a real content type for a recognized extension", () => {
    // A .txt served as text/html shouldn't be forced to text/plain — html is
    // a valid indexable text type, so respect it.
    expect(normalizeUploadMime("page.txt", "text/html")).toBe("text/html");
  });
});

describe("uploadValidationError (unchanged sniffing)", () => {
  it("passes a real PNG header", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(uploadValidationError(png, "image/png")).toBeNull();
  });

  it("rejects a JPEG whose bytes are actually PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(uploadValidationError(png, "image/jpeg")).toMatch(/does not match/);
  });

  it("passes through types it cannot sniff", () => {
    expect(uploadValidationError(Buffer.from("col_a,col_b"), "text/csv")).toBeNull();
  });
});
