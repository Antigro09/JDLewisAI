// All client-side traffic is same-origin (the AssemblyAI websocket and every
// third-party API run server-side), so connect-src stays 'self'.
// 'unsafe-inline'/'unsafe-eval' in script-src are required by Next.js's
// inline bootstrap scripts until a nonce-based CSP is wired up.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Dictation and photo capture use getUserMedia, so camera/microphone
    // must stay allowed for our own origin.
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self)",
  },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting is run separately in CI; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Allow larger request bodies for file uploads handled in route handlers.
    // Sized for the material-takeoff action (40 MB total) plus multipart overhead.
    serverActions: {
      bodySizeLimit: "44mb",
    },
    // middleware.ts buffers request bodies with its own 10MB default cap —
    // exceeding it truncates the body ("Unexpected end of form"). Keep in
    // sync with bodySizeLimit above.
    middlewareClientMaxBodySize: "44mb",
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
