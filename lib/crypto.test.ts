import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_ENCRYPTION_KEY } from "@/tests/setup";

const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

/** lib/env snapshots process.env at import time, so each test re-imports
 * lib/crypto through a fresh module registry to control the active key. */
async function importCrypto() {
  vi.resetModules();
  return import("@/lib/crypto");
}

afterEach(() => {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  vi.resetModules();
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips plaintext, including unicode", async () => {
    const { encryptSecret, decryptSecret } = await importCrypto();
    const plain = "ya29.token — ünïcode ✓ 你好";
    const payload = encryptSecret(plain);
    expect(payload).not.toContain(plain);
    expect(decryptSecret(payload)).toBe(plain);
  });

  it("round-trips the empty string", async () => {
    const { encryptSecret, decryptSecret } = await importCrypto();
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("uses a fresh IV per call, so identical plaintexts encrypt differently", async () => {
    const { encryptSecret } = await importCrypto();
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext (GCM auth failure)", async () => {
    const { encryptSecret, decryptSecret } = await importCrypto();
    const raw = Buffer.from(encryptSecret("sensitive"), "base64");
    raw[raw.length - 1] ^= 0xff; // flip bits in the ciphertext body
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });

  it("rejects a tampered auth tag", async () => {
    const { encryptSecret, decryptSecret } = await importCrypto();
    const raw = Buffer.from(encryptSecret("sensitive"), "base64");
    raw[12] ^= 0xff; // tag occupies bytes 12–27
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });

  it("rejects decryption under a different key", async () => {
    const { encryptSecret } = await importCrypto();
    const payload = encryptSecret("sensitive");

    process.env.ENCRYPTION_KEY = OTHER_KEY;
    const { decryptSecret } = await importCrypto();
    expect(() => decryptSecret(payload)).toThrow();
  });

  it("fails fast at import when ENCRYPTION_KEY is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(importCrypto()).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("fails fast at import when ENCRYPTION_KEY does not decode to 32 bytes", async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    await expect(importCrypto()).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});
