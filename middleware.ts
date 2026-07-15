import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { isDesktopRequest } from "@/lib/desktop/gate";

const PUBLIC_PATHS = ["/login", "/signup", "/legal"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Desktop-only gate: with DESKTOP_GATE_SECRET set (production), only the
  // Electron shell's handshake header gets past this point — browsers see a
  // bare 404 before any auth logic (no login redirect, nothing to discover).
  // Matcher exclusions still leak _next/static chunks + icons (code/branding
  // only, no data); /api/* routes enforce their own auth and, where desktop-
  // only, this same gate.
  if (!(await isDesktopRequest(req.headers))) {
    return new NextResponse(null, { status: 404 });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  // The marketing home ("/") is public; the page itself redirects signed-in
  // users on to /chat. Match it exactly so it doesn't open up every path.
  const isPublic =
    pathname === "/" || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!claims && !isPublic) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Admin area requires ADMIN role (SUPERADMIN is a superset). These JWT
  // checks are UX-only early redirects — real authorization happens
  // server-side in requireAdmin()/requireSuperadmin(), which re-check role,
  // disabled and tokenVersion against the database.
  if (
    pathname.startsWith("/admin") &&
    claims?.role !== "ADMIN" &&
    claims?.role !== "SUPERADMIN"
  ) {
    return NextResponse.redirect(new URL("/chat", req.url));
  }

  // Owner console is SUPERADMIN-only.
  if (pathname.startsWith("/owner") && claims?.role !== "SUPERADMIN") {
    return NextResponse.redirect(new URL("/chat", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals, static assets, and API routes
  // (API routes do their own auth checks).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
