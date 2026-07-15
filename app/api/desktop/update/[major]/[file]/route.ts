import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, desktopClients, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { isDesktopRequest } from "@/lib/desktop/gate";
import {
  allowedMajor,
  parseVersion,
  selectRelease,
} from "@/lib/desktop-update/select";
import {
  fetchAssetText,
  listReleases,
  resolveAssetRedirect,
} from "@/lib/desktop-update/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * License-gated update feed for the desktop shell (electron-updater generic
 * provider). Feed base: /api/desktop/update/<installedMajor>
 *   - GET <base>/latest.yml           → manifest of the newest allowed release
 *   - GET <base>/<installer|blockmap> → 302 to GitHub's signed asset URL
 *
 * Entitlement: without a device token the client gets the newest release
 * within its installed major (patches always flow). A valid x-device-token
 * (minted post-login by /api/desktop/token) raises the cap to the company's
 * desktopEntitledMajor. This route sits outside the middleware matcher, so it
 * enforces the desktop gate itself.
 */

type Entitlement = { entitledMajor: number; userId: string; companyId: string };

async function readEntitlement(req: Request): Promise<Entitlement | null> {
  // Never use Authorization here: electron-updater re-sends its headers on
  // the 302 to signed storage, and S3 rejects signed-URL + Authorization.
  const token = req.headers.get("x-device-token");
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.AUTH_SECRET),
    );
    if (payload.scope !== "desktop-update" || !payload.sub || !payload.cid) {
      return null;
    }
    const user = (
      await db.select().from(users).where(eq(users.id, String(payload.sub)))
    )[0];
    if (!user || user.disabled) return null;
    const tv = typeof payload.tv === "number" ? payload.tv : 0;
    if (tv < user.tokenVersion) return null;
    const company = (
      await db
        .select()
        .from(companies)
        .where(eq(companies.id, String(payload.cid)))
    )[0];
    if (!company) return null;
    return {
      entitledMajor: company.desktopEntitledMajor,
      userId: user.id,
      companyId: company.id,
    };
  } catch {
    // Invalid/expired token degrades gracefully to unentitled.
    return null;
  }
}

async function recordLastSeen(req: Request, ent: Entitlement): Promise<void> {
  const version = req.headers.get("x-desktop-version") ?? "";
  if (!parseVersion(version)) return;
  try {
    await db
      .insert(desktopClients)
      .values({ userId: ent.userId, companyId: ent.companyId, version })
      .onConflictDoUpdate({
        target: desktopClients.userId,
        set: { companyId: ent.companyId, version, lastSeenAt: new Date() },
      });
  } catch {
    // Telemetry only — never fail an update check over it.
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ major: string; file: string }> },
) {
  if (!(await isDesktopRequest(req.headers))) {
    return new NextResponse(null, { status: 404 });
  }
  if (!env.GITHUB_RELEASES_TOKEN) {
    return NextResponse.json({ error: "Updates not configured" }, { status: 503 });
  }

  const { major, file } = await params;
  const installedMajor = Number.parseInt(major, 10);
  if (!Number.isInteger(installedMajor) || installedMajor < 0 || `${installedMajor}` !== major) {
    return new NextResponse(null, { status: 404 });
  }

  const entitlement = await readEntitlement(req);

  let releases;
  try {
    releases = await listReleases();
  } catch {
    return NextResponse.json({ error: "Release feed unavailable" }, { status: 502 });
  }

  if (file === "latest.yml") {
    if (entitlement) await recordLastSeen(req, entitlement);
    const release = selectRelease(
      releases,
      installedMajor,
      entitlement?.entitledMajor ?? null,
    );
    const manifest = release?.assets.find((a) => a.name === "latest.yml");
    if (!release || !manifest) return new NextResponse(null, { status: 404 });
    try {
      const yml = await fetchAssetText(manifest.id);
      return new NextResponse(yml, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return NextResponse.json({ error: "Manifest unavailable" }, { status: 502 });
    }
  }

  // Artifact download (installer / blockmap): the filename must carry a
  // version whose major the requester is allowed to receive.
  const fileVersion = parseVersion(file);
  if (
    !fileVersion ||
    fileVersion.major >
      allowedMajor(installedMajor, entitlement?.entitledMajor ?? null)
  ) {
    return new NextResponse(null, { status: 404 });
  }
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const asset = release.assets.find((a) => a.name === file);
    if (!asset) continue;
    const location = await resolveAssetRedirect(asset.id);
    if (!location) break;
    return NextResponse.redirect(location, 302);
  }
  return new NextResponse(null, { status: 404 });
}
