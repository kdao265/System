import type { NextConfig } from "next";
import { getSupabaseConfig } from "./src/lib/supabase/config";

// Validate at configuration load (dev, build and start), without making requests.
getSupabaseConfig();

const nextConfig: NextConfig = {
  // The service worker script itself must never be served stale, otherwise an installed
  // app could keep an old revision of the static-asset cache. Everything else keeps
  // Next.js default caching.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};
export default nextConfig;
