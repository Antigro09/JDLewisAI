import { env } from "@/lib/env";

/**
 * Desktop-only production gate.
 *
 * When DESKTOP_GATE_SECRET is set, only the Electron shell (which injects the
 * secret into every request via this header) can reach the app; plain
 * browsers get a bare 404 from middleware. Unset (local dev) the gate is
 * open. The secret embedded in the exe is extractable by a determined user —
 * this is deliberately an obscurity layer that keeps the product invisible
 * online; real security remains session auth + the update license checks.
 *
 * Edge-safe: middleware runs this, so WebCrypto only — no node:crypto.
 */

export const DESKTOP_GATE_HEADER = "x-desktop-key";

/** Constant-time string comparison. Hashing both sides to fixed-length
 * digests first makes length differences non-observable, then the XOR-fold
 * over the digests avoids early exit on the first mismatching byte. */
export async function timingSafeEqualStrings(
  a: string,
  b: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export function desktopGateEnabled(): boolean {
  return Boolean(env.DESKTOP_GATE_SECRET);
}

/** True when the gate is off (no secret configured) or the request carries
 * the correct handshake header. */
export async function isDesktopRequest(headers: Headers): Promise<boolean> {
  if (!env.DESKTOP_GATE_SECRET) return true;
  const key = headers.get(DESKTOP_GATE_HEADER);
  if (!key) return false;
  return timingSafeEqualStrings(key, env.DESKTOP_GATE_SECRET);
}
