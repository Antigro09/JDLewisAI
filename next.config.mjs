/** @type {import('next').NextConfig} */
const nextConfig = {
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
