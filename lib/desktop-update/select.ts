/**
 * Pure release-selection logic for the license-gated desktop update proxy.
 *
 * License model (major-only gate): patch/minor releases within a client's
 * installed major always flow; a higher major is only offered when the
 * client's company entitlement covers it. No downgrades are ever offered —
 * electron-updater also refuses them client-side.
 */

export type ParsedVersion = { major: number; minor: number; patch: number };

export type ReleaseAsset = { id: number; name: string; size?: number };

export type ReleaseSummary = {
  /** Git tag, e.g. "v1.2.3" or "desktop-v1.2.3". */
  tag: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)/;

/** Extract the first x.y.z triple from a tag ("v1.2.3", "desktop-v1.2.3") or
 * filename ("ContractorAI-Setup-1.2.3.exe", "….exe.blockmap"). */
export function parseVersion(value: string): ParsedVersion | null {
  const m = VERSION_RE.exec(value);
  if (!m) return null;
  const major = Number.parseInt(m[1], 10);
  const minor = Number.parseInt(m[2], 10);
  const patch = Number.parseInt(m[3], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  return { major, minor, patch };
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Highest major a client may receive. Entitlement never strands a client
 * below its own installed major — lowering a company's license later must
 * not cut off patches for what they already run. */
export function allowedMajor(
  installedMajor: number,
  entitledMajor: number | null,
): number {
  return Math.max(installedMajor, entitledMajor ?? installedMajor);
}

/** Pick the newest full release the client is allowed to see, or null. */
export function selectRelease(
  releases: ReleaseSummary[],
  installedMajor: number,
  entitledMajor: number | null,
): ReleaseSummary | null {
  const cap = allowedMajor(installedMajor, entitledMajor);
  let best: { release: ReleaseSummary; version: ParsedVersion } | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const version = parseVersion(release.tag);
    if (!version || version.major > cap) continue;
    // A usable release must carry the electron-updater manifest.
    if (!release.assets.some((a) => a.name === "latest.yml")) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = { release, version };
    }
  }
  return best?.release ?? null;
}
