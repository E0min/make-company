import type { NextConfig } from "next";
import path from "node:path";

const API_TARGET = process.env.VC_API_TARGET ?? "http://localhost:7777";
const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Static export so Python server can serve the built dashboard at /
  output: "export",
  // Trailing slash makes Python file routing simpler (/foo/ → /foo/index.html)
  trailingSlash: true,
  // Image optimization needs a Node server; disable for static export
  images: { unoptimized: true },
  turbopack: {
    root: path.join(__dirname),
  },
  // Rewrites only work in dev — in static export mode this block is skipped.
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
