import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this app even when the parent directory contains
  // unrelated package-lock files.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
