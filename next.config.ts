import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return [
      { source: "/checkout", destination: "/api/checkout" },
      { source: "/webhooks/polar", destination: "/api/webhooks/polar" },
    ];
  },
};

export default nextConfig;
