import { beforeEach, describe, expect, it, vi } from "vitest";
import { TERMS_VERSION } from "@/lib/legal/version";

const requireUser = vi.fn();
const recordAudit = vi.fn();
const redirect = vi.fn();
const dbUpdateSet = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (patch: unknown) => {
        dbUpdateSet(patch);
        return { where: async () => undefined };
      },
    }),
  },
}));

import { acceptTermsAction } from "@/app/accept-terms/actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
});

describe("acceptTermsAction", () => {
  it("rejects submission without the agreement checkbox", async () => {
    const result = await acceptTermsAction({}, new FormData());
    expect(result.error).toMatch(/check the box/i);
    expect(dbUpdateSet).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("records the current version + timestamp, audits, and redirects", async () => {
    const form = new FormData();
    form.set("agree", "on");
    await acceptTermsAction({}, form);
    expect(dbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        termsAcceptedVersion: TERMS_VERSION,
        termsAcceptedAt: expect.any(Date),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "legal.terms_accept",
        detail: expect.stringContaining(TERMS_VERSION),
      }),
    );
    expect(redirect).toHaveBeenCalledWith("/chat");
  });
});
