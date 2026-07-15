import { describe, expect, it } from "vitest";
import {
  allowedMajor,
  compareVersions,
  parseVersion,
  selectRelease,
  type ReleaseSummary,
} from "./select";

function release(
  tag: string,
  opts: { draft?: boolean; prerelease?: boolean; noManifest?: boolean } = {},
): ReleaseSummary {
  const version = tag.replace(/^desktop-v|^v/, "");
  return {
    tag,
    draft: opts.draft ?? false,
    prerelease: opts.prerelease ?? false,
    assets: [
      ...(opts.noManifest ? [] : [{ id: 1, name: "latest.yml" }]),
      { id: 2, name: `ContractorAI-Setup-${version}.exe` },
      { id: 3, name: `ContractorAI-Setup-${version}.exe.blockmap` },
    ],
  };
}

describe("parseVersion", () => {
  it("parses plain, v-prefixed and desktop-v-prefixed tags", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("desktop-v10.20.30")).toEqual({
      major: 10,
      minor: 20,
      patch: 30,
    });
  });

  it("parses versions embedded in artifact filenames", () => {
    expect(parseVersion("ContractorAI-Setup-2.0.1.exe")).toEqual({
      major: 2,
      minor: 0,
      patch: 1,
    });
    expect(parseVersion("ContractorAI-Setup-2.0.1.exe.blockmap")?.major).toBe(2);
  });

  it("returns null when no x.y.z triple exists", () => {
    expect(parseVersion("latest.yml")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    const v = (s: string) => parseVersion(s)!;
    expect(compareVersions(v("2.0.0"), v("1.9.9"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.3.0"), v("1.2.9"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.2.3"), v("1.2.4"))).toBeLessThan(0);
    expect(compareVersions(v("1.2.3"), v("1.2.3"))).toBe(0);
  });
});

describe("allowedMajor", () => {
  it("uses the entitlement when it exceeds the installed major", () => {
    expect(allowedMajor(1, 2)).toBe(2);
  });

  it("never drops below the installed major (lowered entitlement)", () => {
    expect(allowedMajor(2, 1)).toBe(2);
  });

  it("falls back to the installed major without an entitlement", () => {
    expect(allowedMajor(1, null)).toBe(1);
  });
});

describe("selectRelease", () => {
  const releases = [
    release("desktop-v1.0.0"),
    release("v1.1.0"),
    release("v1.2.0"),
    release("v2.0.0"),
    release("v2.1.0"),
  ];

  it("serves the newest patch/minor within the installed major without a license", () => {
    expect(selectRelease(releases, 1, null)?.tag).toBe("v1.2.0");
  });

  it("offers the newer major only when the entitlement covers it", () => {
    expect(selectRelease(releases, 1, 1)?.tag).toBe("v1.2.0");
    expect(selectRelease(releases, 1, 2)?.tag).toBe("v2.1.0");
  });

  it("keeps serving an installed major above a lowered entitlement", () => {
    expect(selectRelease(releases, 2, 1)?.tag).toBe("v2.1.0");
  });

  it("ignores drafts and prereleases", () => {
    const withUnpublished = [
      ...releases,
      release("v3.0.0", { draft: true }),
      release("v3.1.0", { prerelease: true }),
    ];
    expect(selectRelease(withUnpublished, 1, 99)?.tag).toBe("v2.1.0");
  });

  it("ignores releases without an updater manifest", () => {
    const withBroken = [...releases, release("v2.2.0", { noManifest: true })];
    expect(selectRelease(withBroken, 2, null)?.tag).toBe("v2.1.0");
  });

  it("ignores unparseable tags and returns null when nothing qualifies", () => {
    expect(selectRelease([release("nightly")], 1, null)).toBeNull();
    expect(selectRelease([], 1, null)).toBeNull();
  });
});
