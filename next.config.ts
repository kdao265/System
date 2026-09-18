import type { NextConfig } from "next";
import { getSupabaseConfig } from "./src/lib/supabase/config";

// Validate at configuration load (dev, build and start), without making requests.
getSupabaseConfig();

const nextConfig: NextConfig = {};
export default nextConfig;
