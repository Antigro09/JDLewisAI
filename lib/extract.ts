/**
 * Text extraction for project-file indexing (spec §13). Turns a stored file
 * (mime + raw bytes) into per-page text so chunks can carry page numbers into
 * citations. Plain-text formats extract as a single page-less unit; PDFs
 * extract per page via unpdf (serverless pdf.js build — pure JS, no workers).
 *
 * Scanned/image-only PDFs yield empty text and are reported as such — the
 * caller decides whether to log/skip. OCR is intentionally out of scope here.
 */

export type ExtractedUnit = {
  /** 1-based page number for paginated formats (PDF); null for plain text. */
  page: number | null;
  text: string;
};

/** MIME types whose bytes are UTF-8 text we can index directly. */
export function isPlainTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/csv"].includes(mime)
  );
}

/** Every MIME type the indexer can turn into searchable text. */
export function isIndexableMime(mime: string): boolean {
  return isPlainTextMime(mime) || mime === "application/pdf";
}

/**
 * Extract indexable text units from a file. Returns [] when the file has no
 * extractable text (image-only PDF, undecodable bytes, unsupported type).
 * Never throws — extraction failures degrade to "not indexable".
 */
export async function extractFileText(
  mime: string,
  data: Buffer,
): Promise<ExtractedUnit[]> {
  if (isPlainTextMime(mime)) {
    try {
      let text = data.toString("utf8");
      if (!text.trim()) return [];
      // Minified JSON is one enormous line — pretty-print it so the chunker
      // splits on key boundaries instead of slicing mid-token.
      if (mime === "application/json" || mime === "text/json") {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          /* not valid JSON — index the raw text */
        }
      }
      return [{ page: null, text }];
    } catch {
      return [];
    }
  }

  if (mime === "application/pdf") {
    try {
      // Dynamic import keeps pdf.js out of the bundle for the common
      // plain-text path and out of client bundles entirely.
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: false });
      const pages = (Array.isArray(text) ? text : [text]).map((t, i) => ({
        page: i + 1,
        text: typeof t === "string" ? t : "",
      }));
      // Image-only/scanned pages extract as empty — drop them; if every page
      // is empty the whole file reports as unindexable.
      return pages.filter((p) => p.text.trim().length > 0);
    } catch {
      return [];
    }
  }

  return [];
}
