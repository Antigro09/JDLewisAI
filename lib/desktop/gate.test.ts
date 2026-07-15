import { afterEach, describe, expect, it, vi } from "vitest";

// lib/env snapshots process.env at import time, so each scenario resets
// modules and re-imports the gate with the desired environment.
async function importGate(secret?: string) {
  vi.resetModules();
  if (secret === undefined) delete process.env.DESKTOP_GATE_SECRET;
  else process.env.DESKTOP_GATE_SECRET = secret;
  return import("./gate");
}

afterEach(() => {
  delete process.env.DESKTOP_GATE_SECRET;
});

describe("timingSafeEqualStrings", () => {
  it("matches equal strings and rejects different ones", async () => {
    const { timingSafeEqualStrings } = await importGate();
    expect(await timingSafeEqualStrings("secret-value", "secret-value")).toBe(true);
    expect(await timingSafeEqualStrings("secret-value", "secret-другой")).toBe(false);
  });

  it("rejects different-length strings", async () => {
    const { timingSafeEqualStrings } = await importGate();
    expect(await timingSafeEqualStrings("short", "short-but-longer")).toBe(false);
  });
});

describe("isDesktopRequest", () => {
  it("is always true when no gate secret is configured (dev)", async () => {
    const { isDesktopRequest, desktopGateEnabled } = await importGate();
    expect(desktopGateEnabled()).toBe(false);
    expect(await isDesktopRequest(new Headers())).toBe(true);
  });

  it("accepts the matching handshake header", async () => {
    const { isDesktopRequest, DESKTOP_GATE_HEADER, desktopGateEnabled } =
      await importGate("a-sufficiently-long-secret");
    expect(desktopGateEnabled()).toBe(true);
    const headers = new Headers({
      [DESKTOP_GATE_HEADER]: "a-sufficiently-long-secret",
    });
    expect(await isDesktopRequest(headers)).toBe(true);
  });

  it("rejects a wrong or missing header when gated", async () => {
    const { isDesktopRequest, DESKTOP_GATE_HEADER } = await importGate(
      "a-sufficiently-long-secret",
    );
    expect(await isDesktopRequest(new Headers())).toBe(false);
    expect(
      await isDesktopRequest(new Headers({ [DESKTOP_GATE_HEADER]: "wrong" })),
    ).toBe(false);
  });
});
