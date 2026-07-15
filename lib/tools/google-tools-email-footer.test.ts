import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION_EMAIL_FOOTER } from "@/lib/legal/disclaimers";

// Unattended automation sends must carry the AI-authorship footer; interactive
// sends (a human pressed approve) must not be modified.

const gmailSend = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    // gateUnattendedSend's atomic daily-cap reservation — always succeeds here.
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [{ id: "auto-1" }] }),
      }),
    }),
  },
}));
vi.mock("@/lib/google/client", () => ({
  getValidAccessToken: async () => "token",
  GoogleNotConnectedError: class extends Error {},
}));
vi.mock("@/lib/google/gmail", () => ({
  gmailSearch: vi.fn(),
  gmailReadMessage: vi.fn(),
  gmailSend: (...a: unknown[]) => gmailSend(...a),
  gmailCreateDraft: vi.fn(),
}));
vi.mock("@/lib/google/drive", () => ({ driveSearch: vi.fn(), driveReadFile: vi.fn() }));
vi.mock("@/lib/google/docs", () => ({
  docsCreate: vi.fn(),
  docsAppendText: vi.fn(),
  docsReplaceText: vi.fn(),
}));
vi.mock("@/lib/google/sheets", () => ({
  sheetsCreate: vi.fn(),
  sheetsAppendRows: vi.fn(),
  sheetsRead: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

import { runGoogleTool } from "./google-tools";

const input = {
  to: "client@example.com",
  subject: "Weekly report",
  body: "Here is the report.",
};

beforeEach(() => {
  vi.clearAllMocks();
  gmailSend.mockResolvedValue({ output: "sent", summary: "sent" });
});

describe("unattended automation email footer", () => {
  it("appends the AI footer on unattended sends", async () => {
    await runGoogleTool("user-1", "gmail_send", { ...input }, {
      unattended: true,
      automation: {
        id: "auto-1",
        sendAllowlist: ["client@example.com"],
        maxSendsPerDay: 5,
      } as never,
    });
    expect(gmailSend).toHaveBeenCalledTimes(1);
    const sentInput = gmailSend.mock.calls[0][1] as { body: string };
    expect(sentInput.body).toBe(`Here is the report.${AUTOMATION_EMAIL_FOOTER}`);
  });

  it("leaves interactive sends untouched", async () => {
    await runGoogleTool("user-1", "gmail_send", { ...input });
    const sentInput = gmailSend.mock.calls[0][1] as { body: string };
    expect(sentInput.body).toBe("Here is the report.");
  });
});
