import { describe, expect, it } from "vitest";
import { termsAccepted } from "@/lib/legal/gate";
import { TERMS_VERSION } from "@/lib/legal/version";

describe("clickwrap terms gate", () => {
  it("gates users who never accepted (null version)", () => {
    expect(termsAccepted({ termsAcceptedVersion: null, role: "MEMBER" })).toBe(false);
  });

  it("re-gates users after a version bump (stale acceptance)", () => {
    expect(
      termsAccepted({ termsAcceptedVersion: "2020-01-01.1", role: "ADMIN" }),
    ).toBe(false);
  });

  it("passes users who accepted the current version", () => {
    expect(
      termsAccepted({ termsAcceptedVersion: TERMS_VERSION, role: "MEMBER" }),
    ).toBe(true);
  });

  it("exempts the SUPERADMIN (the licensor)", () => {
    expect(termsAccepted({ termsAcceptedVersion: null, role: "SUPERADMIN" })).toBe(true);
  });
});
