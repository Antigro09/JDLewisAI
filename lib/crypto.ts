import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM encryption for secrets at rest (e.g. Google OAuth tokens).
 * ENCRYPTION_KEY is validated (base64, exactly 32 bytes) in lib/env.ts.
 */
function key(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
