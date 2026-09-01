import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return [
      { source: "/checkout", destination: "/api/checkout" },
      { source: "/webhooks/waffo", destination: "/api/webhooks/waffo" },
      { source: "/webhooks/polar", destination: "/api/webhooks/polar" },
    ];
  },
};

export default nextConfig;
