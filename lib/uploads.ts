/**
 * Upload validation shared by the file-upload server actions: a size ceiling
 * plus magic-byte sniffing for the binary types we store (png/jpg/webp/gif/
 * pdf). A file whose content doesn't match its claimed MIME is rejected;
 * types we can't sniff (text, docx, heic, ...) pass through on size alone.
 */

// Default per-file ceiling for general uploads. Must stay under the
// serverActions bodySizeLimit in next.config.mjs (44mb).
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

function startsWith(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((byte, i) => buf[i] === byte);
}

const isJpeg = (b: Buffer) => startsWith(b, [0xff, 0xd8, 0xff]);

const MAGIC_CHECKS: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": isJpeg,
  "image/jpg": isJpeg,
  "image/gif": (b) =>
    startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || // GIF87a
    startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  "image/webp": (b) =>
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP",
  // Readers tolerate a little junk before the header, so scan the first 1 KB.
  "application/pdf": (b) => b.subarray(0, 1024).includes("%PDF-"),
};

/** Null when the content is plausible for the claimed MIME, else an error message. */
export function uploadValidationError(
  buf: Buffer,
  claimedMime: string,
): string | null {
  const check = MAGIC_CHECKS[claimedMime.toLowerCase()];
  if (!check) return null; // not a type we can sniff
  if (!check(buf)) {
    return `File content does not match its declared type (${claimedMime}).`;
  }
  return null;
}

/**
 * Read an uploaded File, enforcing the size ceiling and magic-byte check.
 * Throws an Error with a user-facing message on rejection.
 */
export async function readUploadOrThrow(
  file: File,
  opts: { maxBytes?: number } = {},
): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`File exceeds ${Math.floor(maxBytes / (1024 * 1024))} MB limit`);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const error = uploadValidationError(buf, file.type || "");
  if (error) throw new Error(error);
  return buf;
}
