import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the app scoped to this package when it is deployed from a monorepo.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
