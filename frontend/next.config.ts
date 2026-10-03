import type { NextConfig } from "next";

const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

const config: NextConfig = {
  // Same-origin proxy so the session cookie is first-party on this site.
  async rewrites() {
    return API ? [{ source: "/api/:path*", destination: `${API}/:path*` }] : [];
  },
};

export default config;
