import { describe, expect, it } from "vitest";
import { attachmentBlocks } from "./chat";

const b64 = Buffer.from("x").toString("base64");

describe("attachmentBlocks media-type handling", () => {
  it("emits real image blocks for supported types", () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      const [block] = attachmentBlocks({ mime, name: "p", dataBase64: b64 });
      expect(block.type).toBe("image");
    }
  });

  it("falls back to a text placeholder for unsupported image types", () => {
    // HEIC/BMP/TIFF/SVG would 400 the API and brick the conversation on replay.
    for (const mime of ["image/heic", "image/bmp", "image/tiff", "image/svg+xml"]) {
      const [block] = attachmentBlocks({ mime, name: "shot", dataBase64: b64 });
      expect(block.type).toBe("text");
    }
  });
});
