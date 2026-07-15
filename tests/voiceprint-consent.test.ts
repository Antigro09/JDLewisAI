import { beforeEach, describe, expect, it, vi } from "vitest";
import { VOICEPRINT_CONSENT_VERSION } from "@/lib/legal/version";

// Route-level unit test: biometric consent headers are required before a
// voiceprint embedding is created; name-only fallbacks skip the check.

const getCurrentUser = vi.fn();
const ensureCompanyForUser = vi.fn();
const enrollSpeaker = vi.fn();
const embedVoice = vi.fn();
const voiceprintConfigured = vi.fn();
const recordAudit = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
}));
vi.mock("@/lib/meetings/access", () => ({
  ensureCompanyForUser: (...a: unknown[]) => ensureCompanyForUser(...a),
}));
vi.mock("@/lib/meetings/speakers", () => ({
  enrollSpeaker: (...a: unknown[]) => enrollSpeaker(...a),
}));
vi.mock("@/lib/meetings/voiceprint", () => ({
  embedVoice: (...a: unknown[]) => embedVoice(...a),
  voiceprintConfigured: (...a: unknown[]) => voiceprintConfigured(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { POST } from "@/app/api/meetings/enroll-voice/route";

function request(headers: Record<string, string> = {}, body = "audio-bytes") {
  return new Request("http://localhost/api/meetings/enroll-voice?name=Pat", {
    method: "POST",
    headers: { "content-type": "audio/webm", ...headers },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  ensureCompanyForUser.mockResolvedValue({ id: "company-1" });
  enrollSpeaker.mockImplementation(async (opts: { displayName: string }) => ({
    id: "profile-1",
    displayName: opts.displayName,
  }));
  embedVoice.mockResolvedValue([0.1, 0.2, 0.3]);
  voiceprintConfigured.mockReturnValue(true);
});

describe("voiceprint enrollment consent gate", () => {
  it("rejects enrollment without consent headers (403 + written notice)", async () => {
    const res = await POST(request());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
    expect(body.consentNotice).toMatch(/biometric/i);
    expect(body.consentVersion).toBe(VOICEPRINT_CONSENT_VERSION);
    expect(embedVoice).not.toHaveBeenCalled();
    expect(enrollSpeaker).not.toHaveBeenCalled();
  });

  it("rejects a stale consent version", async () => {
    const res = await POST(
      request({
        "x-voiceprint-consent": "true",
        "x-voiceprint-consent-version": "2020-01-01.1",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("enrolls with consent and persists the consent record + audit", async () => {
    const res = await POST(
      request({
        "x-voiceprint-consent": "true",
        "x-voiceprint-consent-version": VOICEPRINT_CONSENT_VERSION,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrolledVoiceprint).toBe(true);
    expect(enrollSpeaker).toHaveBeenCalledWith(
      expect.objectContaining({
        consent: expect.objectContaining({
          textVersion: VOICEPRINT_CONSENT_VERSION,
          byUserId: "user-1",
        }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "voiceprint.enroll" }),
    );
  });

  it("name-only fallback (no voiceprint service) needs no consent", async () => {
    voiceprintConfigured.mockReturnValue(false);
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrolledVoiceprint).toBe(false);
    expect(enrollSpeaker).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: null, consent: null }),
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
