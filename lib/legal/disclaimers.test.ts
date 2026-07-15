import { describe, expect, it } from "vitest";
import * as disclaimers from "./disclaimers";

describe("legal disclaimer copy", () => {
  it("every exported constant is a non-empty string", () => {
    for (const [name, value] of Object.entries(disclaimers)) {
      expect(typeof value, name).toBe("string");
      expect((value as string).trim().length, name).toBeGreaterThan(0);
    }
  });

  it("chat caption tells users to verify AI output", () => {
    expect(disclaimers.AI_CHAT_CAPTION).toMatch(/mistake/i);
    expect(disclaimers.AI_CHAT_CAPTION).toMatch(/verify/i);
  });

  it("document footer disclaims professional advice", () => {
    expect(disclaimers.DOC_FOOTER_DISCLAIMER).toMatch(/not professional/i);
    expect(disclaimers.DOC_FOOTER_DISCLAIMER).toMatch(/verify/i);
  });

  it("takeoff caption denies an accuracy guarantee", () => {
    expect(disclaimers.TAKEOFF_UI_CAPTION).toMatch(/estimator review/i);
    expect(disclaimers.TAKEOFF_UI_CAPTION).toMatch(/no accuracy guarantee/i);
  });

  it("recording consent text discloses third-party transcription", () => {
    expect(disclaimers.DEFAULT_RECORDING_CONSENT_TEXT).toMatch(/transcrib/i);
    expect(disclaimers.DEFAULT_RECORDING_CONSENT_TEXT).toMatch(/third-party/i);
    expect(disclaimers.DEFAULT_RECORDING_CONSENT_TEXT).toMatch(/consent/i);
  });

  it("voiceprint notice covers biometric, retention, and deletion (BIPA)", () => {
    expect(disclaimers.VOICEPRINT_CONSENT_NOTICE).toMatch(/biometric/i);
    expect(disclaimers.VOICEPRINT_CONSENT_NOTICE).toMatch(/retain|retention/i);
    expect(disclaimers.VOICEPRINT_CONSENT_NOTICE).toMatch(/delet/i);
    expect(disclaimers.VOICEPRINT_CONSENT_NOTICE).toMatch(/written consent/i);
  });

  it("automation email footer discloses AI authorship", () => {
    expect(disclaimers.AUTOMATION_EMAIL_FOOTER).toMatch(/AI assistant/i);
  });
});
