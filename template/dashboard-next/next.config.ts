import type { NextConfig } from "next";
import path from "node:path";

const API_TARGET = process.env.VC_API_TARGET ?? "http://localhost:7777";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
