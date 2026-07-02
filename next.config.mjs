/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained build for containerized deploys (Docker/ECS) — bundles a
  // minimal server into .next/standalone instead of requiring node_modules.
  output: "standalone",
  eslint: {
    // Linting is run separately in CI; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Allow larger request bodies for file uploads handled in route handlers.
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
