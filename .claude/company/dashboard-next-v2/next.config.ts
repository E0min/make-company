import type { NextConfig } from "next";
import path from "node:path";

const API_TARGET = process.env.VC_API_TARGET ?? "http://localhost:7777";
const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Static export only in production — dev needs rewrites for API proxy
  ...(isDev ? {} : { output: "export" as const, trailingSlash: true }),
  images: { unoptimized: true },
  turbopack: {
    root: path.join(__dirname),
  },
  // API proxy to Python backend (dev only)
  ...(isDev && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${API_TARGET}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
