import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLegalDoc } from "./content";
import {
  EULA_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "./version";

describe("legal documents", () => {
  it("all three documents parse with title/version frontmatter", () => {
    for (const slug of ["terms", "privacy", "eula"] as const) {
      const doc = getLegalDoc(slug);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.version.length).toBeGreaterThan(0);
      expect(doc.body.length).toBeGreaterThan(500);
    }
  });

  it("frontmatter versions match the constants (bump both together)", () => {
    expect(getLegalDoc("terms").version).toBe(TERMS_VERSION);
    expect(getLegalDoc("privacy").version).toBe(PRIVACY_VERSION);
    expect(getLegalDoc("eula").version).toBe(EULA_VERSION);
  });

  it("drafts carry the attorney-review banner until counsel signs off", () => {
    for (const slug of ["terms", "privacy", "eula"] as const) {
      expect(getLegalDoc(slug).body).toContain("DRAFT FOR ATTORNEY REVIEW");
    }
  });

  it("privacy policy contains the Google Limited Use statement", () => {
    const body = getLegalDoc("privacy").body;
    expect(body).toContain("Google API Services User Data Policy");
    expect(body).toMatch(/Limited Use requirements/);
  });

  it("privacy policy has a biometric section with retention schedule", () => {
    const body = getLegalDoc("privacy").body;
    expect(body).toMatch(/[Bb]iometric/);
    expect(body).toMatch(/voiceprint/i);
    expect(body).toMatch(/[Rr]etention and destruction schedule/);
  });

  it("terms disclaim professional advice and cap liability", () => {
    const body = getLegalDoc("terms").body;
    expect(body).toMatch(/not.*professional engineering/i);
    expect(body).toMatch(/AS IS/);
    expect(body).toMatch(/TWELVE \(12\) MONTHS/);
  });

  it("generated NSIS license.txt is current (run npm run legal:eula after EULA edits)", () => {
    const file = path.join(process.cwd(), "electron", "build", "license.txt");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain(`Version ${EULA_VERSION}`);
    expect(text).toContain("END USER LICENSE AGREEMENT");
  });
});
