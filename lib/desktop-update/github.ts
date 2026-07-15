import { env } from "@/lib/env";
import type { ReleaseSummary } from "./select";

/**
 * Thin GitHub Releases client for the desktop update proxy. Works against a
 * private repo via GITHUB_RELEASES_TOKEN (fine-grained PAT, contents: read).
 * Release listings and manifest texts are cached in-memory for 5 minutes —
 * shells only poll every 4 hours, this just keeps bursts off the API.
 */

const DEFAULT_REPO = "Antigro09/JDLewisAI";
const CACHE_TTL_MS = 5 * 60 * 1000;
const API_VERSION = "2022-11-28";

function repo(): string {
  return env.GITHUB_RELEASES_REPO || DEFAULT_REPO;
}

function baseHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_RELEASES_TOKEN}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "ContractorAI-UpdateProxy",
  };
}

type CacheEntry<T> = { at: number; value: T };

let releasesCache: CacheEntry<ReleaseSummary[]> | null = null;
const assetTextCache = new Map<number, CacheEntry<string>>();

function fresh<T>(entry: CacheEntry<T> | null | undefined): T | null {
  return entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.value : null;
}

type GitHubReleaseRow = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { id: number; name: string; size: number }[];
};

export async function listReleases(): Promise<ReleaseSummary[]> {
  const cached = fresh(releasesCache);
  if (cached) return cached;

  const res = await fetch(
    `https://api.github.com/repos/${repo()}/releases?per_page=30`,
    {
      headers: { ...baseHeaders(), Accept: "application/vnd.github+json" },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub releases list failed: ${res.status}`);
  }
  const rows = (await res.json()) as GitHubReleaseRow[];
  const releases: ReleaseSummary[] = rows.map((r) => ({
    tag: r.tag_name,
    draft: r.draft,
    prerelease: r.prerelease,
    assets: r.assets.map((a) => ({ id: a.id, name: a.name, size: a.size })),
  }));
  releasesCache = { at: Date.now(), value: releases };
  return releases;
}

/** Download a small text asset (latest.yml) through the API. */
export async function fetchAssetText(assetId: number): Promise<string> {
  const cached = fresh(assetTextCache.get(assetId));
  if (cached) return cached;

  const res = await fetch(
    `https://api.github.com/repos/${repo()}/releases/assets/${assetId}`,
    {
      headers: { ...baseHeaders(), Accept: "application/octet-stream" },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub asset ${assetId} fetch failed: ${res.status}`);
  }
  const text = await res.text();
  assetTextCache.set(assetId, { at: Date.now(), value: text });
  return text;
}

/** Resolve a large asset (installer) to its short-lived signed storage URL so
 * the route can 302 the client instead of streaming ~100 MB through Next. */
export async function resolveAssetRedirect(
  assetId: number,
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo()}/releases/assets/${assetId}`,
    {
      headers: { ...baseHeaders(), Accept: "application/octet-stream" },
      redirect: "manual",
      cache: "no-store",
    },
  );
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) return location;
  // Signed URLs are per-request and expire in minutes — never cache these.
  return null;
}
