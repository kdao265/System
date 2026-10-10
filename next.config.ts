import type { NextConfig } from "next";
import { getSupabaseConfig } from "./src/lib/supabase/config";

getSupabaseConfig();

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      // AO routes may contain private owner data once L1 passes runtime acceptance.
      // Prevent browser/proxy persistence even in the current UI-only gate.
      { source: "/opportunities/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] },
      { source: "/activities/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] },
    ];
  },
};
export default nextConfig;
